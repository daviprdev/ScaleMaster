import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { normalizeProcessingMode, resolveMediaUrlNow, isImageMedia } from "@/lib/video-processing";
import { fetch as undiciFetch } from "undici";

export const runtime = "nodejs";
export const maxDuration = 180;

const GRAPH_IG = "https://graph.instagram.com/v21.0";

interface AccountRow {
  id: string;
  username: string;
  is_active: boolean;
  meta_access_token: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
}

interface PostAccountResult {
  account_id: string;
  username: string;
  status: "published" | "failed";
  media_id?: string;
  error?: string;
}

async function postFirstComment(
  mediaId: string,
  token: string,
  comment: string
): Promise<void> {
  const formBody = [
    `message=${encodeURIComponent(comment)}`,
    `access_token=${encodeURIComponent(token)}`,
  ].join("&");
  const res = await undiciFetch(`${GRAPH_IG}/${mediaId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, scheduled: false, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as {
    media_url: string;
    caption: string;
    first_comment: string;
    post_type: "reel" | "feed" | "story";
    scheduled_for: string | null;
    account_ids: string[];
    video_processing_mode?: string;
    share_to_feed?: boolean;
  };

  const { media_url, caption, first_comment, post_type, scheduled_for, account_ids } = body;
  const processingMode = normalizeProcessingMode(body.video_processing_mode);
  const shareToFeed = typeof body.share_to_feed === "boolean" ? body.share_to_feed : null;

  if (!media_url) return NextResponse.json({ error: "URL da mídia obrigatória." }, { status: 400 });
  if (!account_ids?.length) return NextResponse.json({ error: "Selecione ao menos uma conta." }, { status: 400 });

  const admin = getSupabaseAdmin() as any;

  // Valida ownership de TODAS as contas antes de criar qualquer registro —
  // impede publicar/agendar em conta de outro usuário via account_id vazado/adivinhado.
  const { data: ownedAccountRows } = await admin
    .from("instagram_accounts")
    .select("id")
    .in("id", account_ids)
    .eq("user_id", user.id);
  const ownedAccountIds = new Set((ownedAccountRows ?? []).map((a: { id: string }) => a.id));
  const notOwned = account_ids.filter((id: string) => !ownedAccountIds.has(id));
  if (notOwned.length > 0) {
    return NextResponse.json(
      { error: "Uma ou mais contas não pertencem a este usuário." },
      { status: 403 }
    );
  }

  // Create single_posts record
  const { data: post, error: postErr } = await admin
    .from("single_posts")
    .insert({
      user_id: user.id,
      media_url,
      caption: caption ?? "",
      first_comment: first_comment ?? "",
      post_type: post_type ?? "reel",
      scheduled_for: scheduled_for ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (postErr) return NextResponse.json({ error: postErr.message }, { status: 500 });

  // Create per-account rows
  await admin.from("single_post_accounts").insert(
    account_ids.map((account_id: string) => ({
      post_id: post.id,
      account_id,
      status: "pending",
    }))
  );

  // Scheduled: save and return — cron will publish later
  if (scheduled_for) {
    return NextResponse.json({ success: true, scheduled: true, post_id: post.id });
  }

  // Publish now: fetch account credentials
  const { data: accounts, error: accsErr } = await admin
    .from("instagram_accounts")
    .select("id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id")
    .in("id", account_ids)
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (accsErr || !accounts?.length) {
    await admin.from("single_posts").update({ status: "failed" }).eq("id", post.id);
    await admin
      .from("single_post_accounts")
      .update({ status: "failed", error_message: "Conta inativa ou não encontrada." })
      .eq("post_id", post.id);
    return NextResponse.json({ error: "Nenhuma conta ativa encontrada." }, { status: 404 });
  }

  // Contas do body que não vieram na query (inativas nesse meio tempo) não devem
  // ficar presas em "pending" pra sempre — marca falha explícita pra cada uma.
  const returnedIds = new Set((accounts as AccountRow[]).map(a => a.id));
  const missingIds = account_ids.filter((id: string) => !returnedIds.has(id));
  if (missingIds.length > 0) {
    await admin
      .from("single_post_accounts")
      .update({ status: "failed", error_message: "Conta inativa ou não encontrada no momento da publicação." })
      .eq("post_id", post.id)
      .in("account_id", missingIds);
  }

  await admin.from("single_posts").update({ status: "publishing" }).eq("id", post.id);

  const results: PostAccountResult[] = [];

  for (const account of accounts as AccountRow[]) {
    await admin
      .from("single_post_accounts")
      .update({ status: "publishing" })
      .eq("post_id", post.id)
      .eq("account_id", account.id);

    if (!account.meta_access_token || !account.ig_business_account_id) {
      await admin
        .from("single_post_accounts")
        .update({ status: "failed", error_message: "Conta sem credenciais Meta. Reconecte em Contas." })
        .eq("post_id", post.id)
        .eq("account_id", account.id);
      results.push({ account_id: account.id, username: account.username, status: "failed", error: "Sem credenciais Meta." });
      continue;
    }

    let tokenToUse = account.meta_access_token;
    if (isTokenExpiringSoon(account.token_expires_at, 7)) {
      try {
        const { token, expiresAt } = await refreshMetaToken(account.meta_access_token, account.fb_page_id);
        await admin
          .from("instagram_accounts")
          .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
          .eq("id", account.id);
        tokenToUse = token;
      } catch {
        console.warn(`[posts/create] Falha ao renovar token de @${account.username}, usando atual.`);
      }
    }

    // Processamento de video: escolha explicita do usuario.
    //   original       -> URL original direto pra Meta (zero FFmpeg). Padrao.
    //   clean_metadata -> variante (stream copy) reutilizada entre contas.
    // Aqui a preparacao e SINCRONA porque o usuario esta esperando a resposta —
    // e a variante e deduplicada, entao so a primeira conta paga o custo.
    // Nunca re-encoda. Se a limpeza falhar, a conta NAO publica: o video
    // original nunca substitui a versao limpa que o usuario escolheu.
    let effectiveMediaUrl = media_url;
    if (!isImageMedia(media_url)) {
      const prepared = await resolveMediaUrlNow(admin, {
        mode: processingMode,
        sourceUrl: media_url,
        userId: user.id,
        scope: `posts/create @${account.username}`,
      });
      if (!prepared.ok) {
        const msg = `[LIMPEZA DE METADADOS] ${prepared.reason}. Nada foi publicado com o video original.`;
        await admin
          .from("single_post_accounts")
          .update({ status: "failed", error_message: msg })
          .eq("post_id", post.id)
          .eq("account_id", account.id);
        results.push({ account_id: account.id, username: account.username, status: "failed", error: msg });
        continue;
      }
      effectiveMediaUrl = prepared.url;
    }

    try {
      const result = await publishViaMetaAPI(
        account.ig_business_account_id,
        tokenToUse,
        effectiveMediaUrl,
        caption ?? "",
        // Story não aceita share_to_feed; publishViaMetaAPI só publica REELS.
        post_type === "story" ? null : shareToFeed
      );

      if (result.status !== "ok") throw new Error(result.error ?? "Erro na Meta API.");

      // Post first comment if provided (non-critical)
      if (first_comment?.trim() && result.media_id) {
        try {
          await postFirstComment(result.media_id, tokenToUse, first_comment.trim());
        } catch {
          console.warn(`[posts/create] Falha ao postar primeiro comentário para @${account.username}.`);
        }
      }

      await admin
        .from("single_post_accounts")
        .update({ status: "published", media_id: result.media_id ?? null, published_at: new Date().toISOString() })
        .eq("post_id", post.id)
        .eq("account_id", account.id);

      results.push({ account_id: account.id, username: account.username, status: "published", media_id: result.media_id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin
        .from("single_post_accounts")
        .update({ status: "failed", error_message: msg })
        .eq("post_id", post.id)
        .eq("account_id", account.id);
      results.push({ account_id: account.id, username: account.username, status: "failed", error: msg });
    }
  }

  const allOk = results.every(r => r.status === "published");
  const anyOk = results.some(r => r.status === "published");
  const finalStatus = allOk ? "published" : anyOk ? "partial" : "failed";

  await admin.from("single_posts").update({ status: finalStatus }).eq("id", post.id);

  return NextResponse.json({ success: anyOk, scheduled: false, results, post_id: post.id });
}

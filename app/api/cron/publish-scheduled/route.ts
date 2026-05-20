import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";

export const runtime = "nodejs";
export const maxDuration = 300;

interface AccountRow {
  id: string;
  username: string;
  is_active: boolean;
  meta_access_token: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
}

interface PostRow {
  id: string;
  video_id: string | null;
  video_url: string | null;
  caption: string | null;
  account_id: string;
  instagram_accounts: AccountRow | null;
  videos_library: { public_url: string } | null;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: rows, error: fetchErr } = await admin
    .from("scheduled_posts")
    .select(
      "id, video_id, video_url, caption, account_id, " +
      "instagram_accounts(id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id), " +
      "videos_library(public_url)"
    )
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (fetchErr) {
    console.error("[cron] Erro ao buscar posts:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const posts = (rows ?? []) as unknown as PostRow[];
  console.log(`[cron] ${posts.length} post(s) pendente(s) encontrado(s).`);

  const summary = { total: posts.length, published: 0, failed: 0, skipped: 0 };

  for (const post of posts) {
    // Claim atômico: previne dupla publicação em execuções concorrentes
    const { data: claimed } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed?.length) {
      summary.skipped++;
      continue;
    }

    const account = post.instagram_accounts;
    const videoUrl = post.video_url ?? post.videos_library?.public_url ?? null;

    if (!account || !account.is_active) {
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: "Conta não encontrada ou inativa." })
        .eq("id", post.id);
      summary.failed++;
      continue;
    }

    if (!videoUrl) {
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: "URL do vídeo não encontrada." })
        .eq("id", post.id);
      summary.failed++;
      continue;
    }

    if (!account.meta_access_token || !account.ig_business_account_id) {
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: "Conta sem credenciais Meta. Reconecte a conta em Contas." })
        .eq("id", post.id);
      summary.failed++;
      continue;
    }

    const caption = post.caption ?? "";

    try {
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
          console.warn(`[cron] Falha ao renovar token de @${account.username}, usando atual.`);
        }
      }

      const result = await publishViaMetaAPI(
        account.ig_business_account_id,
        tokenToUse,
        videoUrl,
        caption
      );

      if (result.status !== "ok") throw new Error(result.error ?? "Erro na Meta API.");

      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          media_id: result.media_id ?? null,
          error_message: null,
        })
        .eq("id", post.id);

      summary.published++;
      console.log(`[cron] ✓ @${account.username} → media_id: ${result.media_id}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron] ✗ @${account.username}:`, msg);
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: msg })
        .eq("id", post.id);
      summary.failed++;
    }
  }

  console.log("[cron] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}

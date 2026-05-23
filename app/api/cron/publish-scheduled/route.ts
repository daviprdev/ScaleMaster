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
  scheduled_at: string;
  account_id: string;
  instagram_accounts: AccountRow | null;
  videos_library: { public_url: string } | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  // Enforce auth only when CRON_SECRET is configured.
  // Without it, allow the route through (safe for initial setup / manual debug via browser).
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!cronSecret) {
    console.warn("[publish-scheduled] AVISO: CRON_SECRET não configurado — rota acessível sem autenticação.");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  console.log(`[publish-scheduled] ▶ Iniciando execução. now=${now}`);

  // ── Diagnóstico: conta total de posts na fila ────────────────────────────
  const [{ count: countPending }, { count: countPublishing }] = await Promise.all([
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "publishing"),
  ]);

  const { count: countEligible } = await admin
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("scheduled_at", now);

  console.log(
    `[publish-scheduled] Fila → pending: ${countPending ?? 0} | publishing: ${countPublishing ?? 0} | ` +
    `elegíveis agora (scheduled_at ≤ ${now}): ${countEligible ?? 0}`
  );

  // ── Desbloqueio de posts presos em "publishing" ───────────────────────────
  // Posts que o worker anterior deixou travados (crash após claim, antes do update final).
  // Critério seguro: scheduled_at há mais de 30 min — o worker original já expirou.
  const stuckCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: unblocked, error: unblockErr } = await admin
    .from("scheduled_posts")
    .update({ status: "pending", error_message: null })
    .eq("status", "publishing")
    .lte("scheduled_at", stuckCutoff)
    .select("id");

  if (unblockErr) {
    console.error("[publish-scheduled] Erro ao desbloquear posts presos:", unblockErr.message);
  } else if (unblocked?.length) {
    console.log(`[publish-scheduled] ${unblocked.length} post(s) desbloqueados de "publishing" → "pending" (travados > 30 min)`);
  }

  // ── Busca posts elegíveis ─────────────────────────────────────────────────
  const { data: rows, error: fetchErr } = await admin
    .from("scheduled_posts")
    .select(
      "id, video_id, video_url, caption, scheduled_at, account_id, " +
      "instagram_accounts(id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id), " +
      "videos_library(public_url)"
    )
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (fetchErr) {
    console.error("[publish-scheduled] Erro ao buscar posts elegíveis:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const posts = (rows ?? []) as unknown as PostRow[];
  console.log(`[publish-scheduled] ${posts.length} post(s) a processar nesta execução.`);

  const summary = {
    total: posts.length,
    published: 0,
    failed: 0,
    skipped: 0,
    unblocked: unblocked?.length ?? 0,
    queue_pending: countPending ?? 0,
    queue_eligible: countEligible ?? 0,
  };

  for (const post of posts) {
    console.log(`[publish-scheduled] Processando post ${post.id} | scheduled_at=${post.scheduled_at} | account=${post.account_id}`);

    // Claim atômico: previne dupla publicação em execuções concorrentes
    const { data: claimed } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed?.length) {
      console.log(`[publish-scheduled] Post ${post.id} já foi claimado por outra instância — pulando.`);
      summary.skipped++;
      continue;
    }

    const account = post.instagram_accounts;
    const videoUrl = post.video_url ?? post.videos_library?.public_url ?? null;

    if (!account || !account.is_active) {
      const reason = "Conta não encontrada ou inativa.";
      console.error(`[publish-scheduled] ✗ Post ${post.id}: ${reason}`);
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: reason })
        .eq("id", post.id);
      summary.failed++;
      continue;
    }

    if (!videoUrl) {
      const reason = "URL do vídeo não encontrada.";
      console.error(`[publish-scheduled] ✗ Post ${post.id} (@${account.username}): ${reason}`);
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: reason })
        .eq("id", post.id);
      summary.failed++;
      continue;
    }

    if (!account.meta_access_token || !account.ig_business_account_id) {
      const reason = "Conta sem credenciais Meta. Reconecte a conta em Contas.";
      console.error(`[publish-scheduled] ✗ Post ${post.id} (@${account.username}): ${reason}`);
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: reason })
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
          console.log(`[publish-scheduled] Token renovado para @${account.username}`);
        } catch (refreshErr) {
          const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          console.warn(`[publish-scheduled] Falha ao renovar token de @${account.username}: ${refreshMsg} — usando token atual.`);
        }
      }

      console.log(`[publish-scheduled] Publicando via Meta API para @${account.username} (ig_id=${account.ig_business_account_id}) | videoUrl=${videoUrl.slice(0, 80)}...`);

      const result = await publishViaMetaAPI(
        account.ig_business_account_id,
        tokenToUse,
        videoUrl,
        caption
      );

      if (result.status !== "ok") {
        throw new Error(result.error ?? "Erro desconhecido na Meta API.");
      }

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
      console.log(`[publish-scheduled] ✓ @${account.username} → media_id: ${result.media_id}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[publish-scheduled] ✗ @${account.username} (post ${post.id}):`, msg);
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", error_message: msg })
        .eq("id", post.id);
      summary.failed++;
    }
  }

  console.log("[publish-scheduled] ■ Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}

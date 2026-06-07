import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const GRAPH = "https://graph.instagram.com/v21.0";
const STALE_MS = 5 * 60 * 1000; // only re-sync if data is > 5 min old
// Apenas tokens genuinamente mortos justificam marcar health_status='error'.
// 190 = Invalid OAuth 2.0 Access Token (token expirado/revogado)
// 102/104 = Session key invalid / Incorrect signature
// Códigos de permissão (200, 10, 368) e rate limit (4, 17) NÃO marcam como error:
// permissão pode ser temporária ou específica de campo; rate limit é transitório.
const TOKEN_ERROR_CODES = new Set([190, 102, 104]);

interface AccountRow {
  id: string;
  username: string;
  user_id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  profile_refreshed_at: string | null;
}

async function syncOne(acc: AccountRow): Promise<{ id: string; ok: boolean; tokenError?: boolean }> {
  const admin = getSupabaseAdmin();
  try {
    const profileUrl =
      `${GRAPH}/${acc.ig_business_account_id}` +
      `?fields=followers_count,media_count,name,profile_picture_url` +
      `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

    const res = await fetch(profileUrl, { cache: "no-store" });
    const data = (await res.json()) as Record<string, unknown>;

    if (data.error) {
      const err = data.error as { code: number; message: string };
      const tokenBad = TOKEN_ERROR_CODES.has(err.code);
      if (tokenBad) {
        // Marca como error + atualiza profile_refreshed_at para não re-sincronizar
        // a cada abertura de página (conta com error fica "always stale" sem isso)
        await admin
          .from("instagram_accounts")
          .update({ health_status: "error", profile_refreshed_at: new Date().toISOString() })
          .eq("id", acc.id);
        // Grava no failover_logs para o diagnóstico mostrar o motivo real
        void (async () => {
          try {
            await admin.from("failover_logs").insert({
              user_id: acc.user_id,
              failed_account_id: acc.id,
              backup_account_id: null,
              error_reason: `[sync-all] code=${err.code} — ${err.message}`,
            });
          } catch { /* não crítico */ }
        })();
        console.warn(
          `[sync-all] Token inválido para @${acc.username}: code=${err.code} — ${err.message}`
        );
      } else {
        // Erro de permissão/rate-limit — não marca como error, só loga
        console.warn(
          `[sync-all] Erro não-fatal para @${acc.username}: code=${err.code} — ${err.message}`
        );
      }
      return { id: acc.id, ok: false, tokenError: tokenBad };
    }

    // Fetch last post timestamp (non-critical)
    let lastPostAt: string | null = null;
    try {
      const mediaUrl =
        `${GRAPH}/${acc.ig_business_account_id}/media` +
        `?fields=timestamp&limit=1` +
        `&access_token=${encodeURIComponent(acc.meta_access_token)}`;
      const mediaRes = await fetch(mediaUrl, { cache: "no-store" });
      const mediaData = (await mediaRes.json()) as { data?: Array<{ timestamp: string }> };
      lastPostAt = mediaData.data?.[0]?.timestamp ?? null;
    } catch {
      // non-critical
    }

    const update: Record<string, unknown> = {
      followers_count: (data.followers_count as number) ?? 0,
      posts_count: (data.media_count as number) ?? 0,
      profile_refreshed_at: new Date().toISOString(),
      // NÃO incluir health_status: "online" aqui — o cron pode ter marcado
      // a conta como 'error' por motivo de API (não token), e o sync de
      // perfil não deve desfazer essa marcação.
    };
    if (lastPostAt) update.last_post_at = lastPostAt;
    if (data.name) update.display_name = data.name as string;
    if (data.profile_picture_url) update.avatar_url = data.profile_picture_url as string;

    await admin.from("instagram_accounts").update(update).eq("id", acc.id);
    return { id: acc.id, ok: true };
  } catch (err) {
    console.error(`[sync-all] Erro inesperado para @${acc.username}:`, err);
    return { id: acc.id, ok: false };
  }
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("id, username, user_id, ig_business_account_id, meta_access_token, profile_refreshed_at")
    .eq("user_id", user.id)
    .neq("health_status", "error")   // contas já marcadas como error não precisam de sync
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ synced: 0, errors: 0, token_errors: 0 });
  }

  // Only sync accounts whose data is stale (never synced or older than STALE_MS)
  const stale = (accounts as unknown as AccountRow[]).filter((a) => {
    if (!a.profile_refreshed_at) return true;
    return Date.now() - new Date(a.profile_refreshed_at).getTime() > STALE_MS;
  });

  if (stale.length === 0) {
    return NextResponse.json({ synced: 0, errors: 0, token_errors: 0, message: "Dados recentes." });
  }

  const results = await Promise.allSettled(stale.map(syncOne));

  let synced = 0;
  let errors = 0;
  let tokenErrors = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.ok) synced++;
      else {
        errors++;
        if (r.value.tokenError) tokenErrors++;
      }
    } else {
      errors++;
    }
  }

  return NextResponse.json({ synced, errors, token_errors: tokenErrors });
}

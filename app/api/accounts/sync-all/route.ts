import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { refreshMetaToken } from "@/lib/meta-refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

const GRAPH = "https://graph.instagram.com/v21.0";
const STALE_MS = 5 * 60 * 1000;

// Apenas tokens genuinamente mortos justificam marcar health_status='error'.
// 190 = Invalid OAuth 2.0 Access Token (token expirado/revogado)
// 102/104 = Session key invalid / Incorrect signature
const TOKEN_ERROR_CODES = new Set([190, 102, 104]);

// Mensagens de code=190 que são erros de INFRAESTRUTURA da Meta (transitórios),
// não tokens mortos. Ocorrem durante instabilidade dos servidores da Meta.
// Tratar como non-fatal: nunca marcar conta como error por esses.
const META_INFRA_MESSAGES = [
  "failed to decrypt",
  "cannot parse access token",
  "malformed access token",
  "could not decrypt",
];

// Cascata real da Meta (outage, secret rotacionado, App desativado) afeta virtualmente
// TODAS as contas ao mesmo tempo — tipicamente 90%+.
// Usar 30% (anterior) era muito sensível: 15 contas ruins num batch de 50 disparavam
// cascade protection e impediam que fossem marcadas como error.
// Regra atual: cascade apenas se >= 70% E no mínimo 5 contas falharem.
const CASCADE_THRESHOLD = 0.7;
const MIN_CASCADE_COUNT = 5;

interface AccountRow {
  id: string;
  username: string;
  user_id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  fb_page_id: string | null;
  profile_refreshed_at: string | null;
}

interface SyncResult {
  id: string;
  user_id: string;
  username: string;
  ok: boolean;
  tokenError?: boolean;
  infraError?: boolean; // erro de infra da Meta — transitório, não marca como error
  tokenRefreshed?: boolean; // token foi renovado com sucesso durante o sync
  errorCode?: number;
  errorMessage?: string;
  update?: Record<string, unknown>;
}

function isMetaInfraError(code: number, message: string): boolean {
  if (code !== 190) return false;
  const lower = message.toLowerCase();
  return META_INFRA_MESSAGES.some(p => lower.includes(p));
}

async function syncOne(acc: AccountRow, admin: ReturnType<typeof getSupabaseAdmin>): Promise<SyncResult> {
  let activeToken = acc.meta_access_token;

  const fetchProfile = async (token: string) => {
    const profileUrl =
      `${GRAPH}/${acc.ig_business_account_id}` +
      `?fields=followers_count,media_count,name,profile_picture_url` +
      `&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(profileUrl, { cache: "no-store" });
    return (await res.json()) as Record<string, unknown>;
  };

  try {
    let data = await fetchProfile(activeToken);

    if (data.error) {
      const err = data.error as { code: number; message: string };

      // "Failed to decrypt" e similares são falhas de infraestrutura da Meta —
      // os servidores deles falharam internamente ao processar o token válido.
      // NÃO indica token morto. Ocorre durante instabilidades/deploys da Meta.
      if (isMetaInfraError(err.code, err.message)) {
        console.warn(
          `[sync-all] ⚠️  Meta infra error para @${acc.username} (code=${err.code}): ` +
          `"${err.message}" — transitório, ignorando sem marcar como error.`
        );
        return {
          id: acc.id, user_id: acc.user_id, username: acc.username,
          ok: false, infraError: true, errorCode: err.code, errorMessage: err.message,
        };
      }

      const tokenBad = TOKEN_ERROR_CODES.has(err.code);

      if (tokenBad) {
        // Antes de marcar como error, tenta renovar o token automaticamente.
        // Contas ociosas têm tokens expirados (60d) — um refresh pode salvar sem interação do usuário.
        console.warn(`[sync-all] code=${err.code} para @${acc.username} — tentando renovar token antes de marcar como error…`);
        try {
          const { token: newToken, expiresAt } = await refreshMetaToken(
            activeToken,
            acc.fb_page_id,
            null
          );
          // Persiste o token renovado imediatamente
          await admin
            .from("instagram_accounts")
            .update({ meta_access_token: newToken, token_expires_at: expiresAt.toISOString() })
            .eq("id", acc.id);

          activeToken = newToken;
          // Retry com o token novo
          data = await fetchProfile(newToken);
          console.log(`[sync-all] ✓ Token renovado para @${acc.username}, expiry: ${expiresAt.toISOString().slice(0, 10)}`);

          if (data.error) {
            // Mesmo com token novo o perfil falhou — agora sim, erro real
            const err2 = data.error as { code: number; message: string };
            console.warn(`[sync-all] Retry após renovação ainda falhou para @${acc.username}: code=${err2.code}`);
            return {
              id: acc.id, user_id: acc.user_id, username: acc.username,
              ok: false, tokenError: TOKEN_ERROR_CODES.has(err2.code),
              errorCode: err2.code, errorMessage: err2.message,
            };
          }
          // Refresh + retry bem-sucedido — continua abaixo com `data` atualizado
        } catch (refreshErr) {
          // Refresh falhou (token genuinamente morto ou revogado)
          const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          console.warn(`[sync-all] Renovação falhou para @${acc.username}: ${refreshMsg.slice(0, 120)}`);
          return {
            id: acc.id, user_id: acc.user_id, username: acc.username,
            ok: false, tokenError: true, errorCode: err.code, errorMessage: err.message,
          };
        }
      } else {
        console.warn(`[sync-all] Erro não-fatal para @${acc.username}: code=${err.code} — ${err.message}`);
        return {
          id: acc.id, user_id: acc.user_id, username: acc.username,
          ok: false, tokenError: false, errorCode: err.code, errorMessage: err.message,
        };
      }
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
    };
    if (lastPostAt) update.last_post_at = lastPostAt;
    if (data.name) update.display_name = data.name as string;
    if (data.profile_picture_url) update.avatar_url = data.profile_picture_url as string;

    return { id: acc.id, user_id: acc.user_id, username: acc.username, ok: true, update };
  } catch (err) {
    console.error(`[sync-all] Erro inesperado para @${acc.username}:`, err);
    return { id: acc.id, user_id: acc.user_id, username: acc.username, ok: false };
  }
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();

  const restored = 0;

  // ── Sync normal: contas online com dados desatualizados ───────────────────
  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("id, username, user_id, ig_business_account_id, meta_access_token, fb_page_id, profile_refreshed_at")
    .eq("user_id", user.id)
    .neq("health_status", "error")
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ synced: 0, errors: 0, token_errors: 0, restored });
  }

  const stale = (accounts as unknown as AccountRow[]).filter((a) => {
    if (!a.profile_refreshed_at) return true;
    return Date.now() - new Date(a.profile_refreshed_at).getTime() > STALE_MS;
  });

  if (stale.length === 0) {
    return NextResponse.json({ synced: 0, errors: 0, token_errors: 0, restored, message: "Dados recentes." });
  }

  // Coleta todos os resultados ANTES de escrever — necessário para cascade detection
  const settled = await Promise.allSettled(stale.map(acc => syncOne(acc, admin)));
  const results: SyncResult[] = settled.map((r) =>
    r.status === "fulfilled" ? r.value : { id: "", user_id: "", username: "", ok: false }
  );

  // Erros de infra (ex: "Failed to decrypt") são excluídos da detecção de cascata:
  // já são tratados como non-fatal individualmente e nunca marcam como error.
  const tokenErrorResults = results.filter((r) => r.tokenError);
  const isCascade =
    tokenErrorResults.length >= MIN_CASCADE_COUNT &&
    tokenErrorResults.length >= Math.ceil(stale.length * CASCADE_THRESHOLD);

  if (isCascade) {
    // Queda em cascata: App Meta desativado, secret rotacionado ou outage da API.
    // Não marcar nenhuma conta como error — evita destruir o painel inteiro por
    // um evento externo temporário.
    console.warn(
      `[sync-all] CASCATA detectada: ${tokenErrorResults.length}/${stale.length} contas com ` +
      `code=${tokenErrorResults[0]?.errorCode} — "${tokenErrorResults[0]?.errorMessage}". ` +
      `Nenhuma conta marcada como error.`
    );
    return NextResponse.json({
      synced: 0,
      errors: tokenErrorResults.length,
      token_errors: tokenErrorResults.length,
      restored,
      cascade: true,
      cascade_message:
        `${tokenErrorResults.length} contas com token inválido ao mesmo tempo — ` +
        `possível queda do App Meta ou tokens expirados em lote. Reconecte as contas.`,
    });
  }

  // Sem cascata: processa writes em paralelo
  let synced = 0;
  let errors = 0;
  let tokenErrors = 0;

  await Promise.all(
    results.map(async (r) => {
      if (r.ok && r.update) {
        await admin.from("instagram_accounts").update(r.update).eq("id", r.id);
        synced++;
      } else if (r.infraError) {
        // Erro de infra da Meta: não marca como error, só loga.
        // A conta tentará novamente no próximo sync.
        errors++;
      } else if (r.tokenError) {
        // Token genuinamente morto (código sem ambiguidade de mensagem)
        await admin
          .from("instagram_accounts")
          .update({ health_status: "error", profile_refreshed_at: new Date().toISOString() })
          .eq("id", r.id);
        // IMPORTANTE: deve ser awaited — funções serverless da Vercel terminam ao enviar
        // a response, cancelando qualquer promise fire-and-forget (void) em voo.
        const { error: logErr } = await admin.from("failover_logs").insert({
          user_id: r.user_id,
          failed_account_id: r.id,
          backup_account_id: null,
          error_reason: `[sync-all] code=${r.errorCode} — ${r.errorMessage}`,
        });
        if (logErr) console.error(`[sync-all] Falha ao gravar failover_log para @${r.username}:`, logErr.message);
        console.warn(`[sync-all] Token inválido para @${r.username}: code=${r.errorCode} — ${r.errorMessage}`);
        errors++;
        tokenErrors++;
      } else if (!r.ok) {
        errors++;
      }
    })
  );

  return NextResponse.json({ synced, errors, token_errors: tokenErrors, restored });
}

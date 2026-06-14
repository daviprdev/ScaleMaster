import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

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

// Se >= essa fração das contas retornar erro de token no mesmo run, é queda em
// cascata (App Meta desativado, secret rotacionado, outage da API) — não marcar
// nenhuma como error para não destruir todo o painel.
// 0.3 = 30%: limiar mais sensível que o anterior (50%) para detectar cascatas
// parciais onde o erro da Meta é intermitente e afeta contas em batches diferentes.
const CASCADE_THRESHOLD = 0.3;

interface AccountRow {
  id: string;
  username: string;
  user_id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  profile_refreshed_at: string | null;
}

interface SyncResult {
  id: string;
  user_id: string;
  username: string;
  ok: boolean;
  tokenError?: boolean;
  infraError?: boolean; // erro de infra da Meta — transitório, não marca como error
  errorCode?: number;
  errorMessage?: string;
  update?: Record<string, unknown>;
}

function isMetaInfraError(code: number, message: string): boolean {
  if (code !== 190) return false;
  const lower = message.toLowerCase();
  return META_INFRA_MESSAGES.some(p => lower.includes(p));
}

async function syncOne(acc: AccountRow): Promise<SyncResult> {
  try {
    const profileUrl =
      `${GRAPH}/${acc.ig_business_account_id}` +
      `?fields=followers_count,media_count,name,profile_picture_url` +
      `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

    const res = await fetch(profileUrl, { cache: "no-store" });
    const data = (await res.json()) as Record<string, unknown>;

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
      if (!tokenBad) {
        console.warn(`[sync-all] Erro não-fatal para @${acc.username}: code=${err.code} — ${err.message}`);
      }
      return {
        id: acc.id, user_id: acc.user_id, username: acc.username,
        ok: false, tokenError: tokenBad, errorCode: err.code, errorMessage: err.message,
      };
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
    .select("id, username, user_id, ig_business_account_id, meta_access_token, profile_refreshed_at")
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
  const settled = await Promise.allSettled(stale.map(syncOne));
  const results: SyncResult[] = settled.map((r) =>
    r.status === "fulfilled" ? r.value : { id: "", user_id: "", username: "", ok: false }
  );

  // Erros de infra (ex: "Failed to decrypt") são excluídos da detecção de cascata:
  // já são tratados como non-fatal individualmente e nunca marcam como error.
  const tokenErrorResults = results.filter((r) => r.tokenError);
  const isCascade = tokenErrorResults.length >= Math.ceil(stale.length * CASCADE_THRESHOLD);

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
        void admin.from("failover_logs").insert({
          user_id: r.user_id,
          failed_account_id: r.id,
          backup_account_id: null,
          error_reason: `[sync-all] code=${r.errorCode} — ${r.errorMessage}`,
        });
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

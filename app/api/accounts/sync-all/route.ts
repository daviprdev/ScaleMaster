import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { refreshMetaToken } from "@/lib/meta-refresh";
import { fetch as undiciFetch } from "undici";
import { getProxyForAccount, proxyInit, isProxyNetworkError, recordProxyFailure } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 60;

const GRAPH = "https://graph.instagram.com/v21.0";
// 6 HORAS (2026-07-17, era 5 min). O sync de perfil é só métrica de painel
// (seguidores/posts mudam devagar) — a detecção de conta caída agora é PASSIVA,
// feita pelo pipeline de postagem (lib/account-health.ts nos crons process-loops/
// publish-pending/publish-scheduled), que já toca a Meta várias vezes por dia
// sem nenhuma chamada extra. Número fresco na hora = botão manual (force).
const STALE_MS = 6 * 60 * 60 * 1000;

// Apenas tokens genuinamente mortos justificam marcar health_status='error'.
// 190 = Invalid OAuth 2.0 Access Token (token expirado/revogado)
// 102/104 = Session key invalid / Incorrect signature
const TOKEN_ERROR_CODES = new Set([190, 102, 104]);

// Mensagens de code=190 que são erros de INFRAESTRUTURA da Meta — transitórios,
// não tokens mortos. Ocorrem durante instabilidade dos servidores da Meta.
// Tratar como non-fatal: nunca marcar conta como error por esses.
const META_INFRA_MESSAGES = [
  "failed to decrypt",
  "cannot parse access token",
  "malformed access token",
  "could not decrypt",
];

// Checkpoint do Instagram ("you cannot access the app till you log in"):
// a conta caiu e exige login manual via browser para voltar. Não é transitório
// do ponto de vista do painel — a conta não posta e não sincroniza até o usuário
// resolver. Deve ficar VERMELHA imediatamente (mesmo comportamento da rota
// /api/accounts/refresh), sem tentar renovar token (renovação não resolve
// checkpoint). Restauração via Failover → Restaurar após o login manual.
const CHECKPOINT_MESSAGES = [
  "you cannot access the app till you log in",
  "log in to www.instagram.com and follow the instructions",
];

// Threshold de cascata: se >= 50% das contas falharem ao mesmo tempo, é provável
// que seja um problema no nível do App ou do Instagram (checkpoint em massa, outage,
// secret rotacionado) — não falhas individuais de token.
// 50% é o equilíbrio: sensível o suficiente para capturar checkpoints em lote (12/17=70%)
// mas sem disparar por falhas isoladas (ex: 2 de 10 = 20%).
// MIN_CASCADE_COUNT=4 evita falso positivo em loops com poucas contas (ex: 2/2=100%).
const CASCADE_THRESHOLD = 0.5;
const MIN_CASCADE_COUNT = 4;

// Tempo mínimo após conexão antes de tentar sync — dá margem para a Meta
// ativar o token em todos os seus servidores e evita marcar contas novas como error.
// Elevado 10 → 30 min (2026-07-15): contas recém-conectadas caíam em checkpoint
// ~30 min após conectar sem nunca ter postado — o padrão robótico de leituras
// via IP datacenter na janela mais sensível do risk engine da Meta era gatilho.
const NEW_ACCOUNT_GRACE_MS = 30 * 60 * 1_000; // 30 minutos

// Contas com menos de 7 dias: NENHUM sync automático (2026-07-17, era 24h com
// cadência 1×/h). É a janela em que o risk engine da Meta está mais sensível a
// padrões robóticos de leitura — conta nova só sincroniza pelo botão manual
// (force), que continua respeitando o grace inicial de 30 min.
const NEW_ACCOUNT_SILENT_BLOCK_MS = 7 * 24 * 60 * 60 * 1_000;

interface AccountRow {
  id: string;
  username: string;
  user_id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  fb_page_id: string | null;
  profile_refreshed_at: string | null;
  connected_at?: string | null;
  proxy_url?: string | null;
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

function isCheckpointError(code: number, message: string): boolean {
  if (code !== 190) return false;
  const lower = message.toLowerCase();
  return CHECKPOINT_MESSAGES.some(p => lower.includes(p));
}

async function syncOne(acc: AccountRow, admin: ReturnType<typeof getSupabaseAdmin>, force: boolean): Promise<SyncResult> {
  let activeToken = acc.meta_access_token;
  const proxy = getProxyForAccount(acc.id, acc.proxy_url ?? null);

  // Política sem-proxy = sem-sync (2026-07-15): nenhuma requisição de sync sai
  // pelo IP da Vercel. Se o proxy não existe ou o decrypt/URL falhou, pula em
  // silêncio (sem marcar erro). Mesma regra do pipeline de postagem.
  if (!proxy) {
    console.warn(`[sync-all] @${acc.username} sem proxy utilizável — sync pulado.`);
    return { id: acc.id, user_id: acc.user_id, username: acc.username, ok: false };
  }

  const fetchProfile = async (token: string) => {
    const profileUrl =
      `${GRAPH}/${acc.ig_business_account_id}` +
      `?fields=followers_count,media_count,name,profile_picture_url` +
      `&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await undiciFetch(
        profileUrl,
        proxyInit(proxy, { signal: AbortSignal.timeout(15_000) }) as any
      );
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      // Proxy morto → NÃO cai para IP Vercel. Registra a falha (ProxyOutageBanner)
      // e pula — a conta tenta de novo no próximo sync.
      const msg = (err as Error).message ?? String(err);
      if (isProxyNetworkError(msg)) {
        await recordProxyFailure(admin, acc.id, "sync-all", msg);
      }
      throw err;
    }
  };

  try {
    let data = await fetchProfile(activeToken);

    if (data.error) {
      const err = data.error as { code: number; message: string };

      // Checkpoint = conta caída de verdade → marca vermelho direto,
      // igual à rota /api/accounts/refresh. Renovar token não resolve checkpoint.
      if (isCheckpointError(err.code, err.message)) {
        console.warn(`[sync-all] 🔴 Checkpoint para @${acc.username} — marcando como error`);
        return {
          id: acc.id, user_id: acc.user_id, username: acc.username,
          ok: false, tokenError: true, errorCode: err.code, errorMessage: err.message,
        };
      }

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
            proxy
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
          const refreshMsg = (refreshErr instanceof Error ? refreshErr.message : String(refreshErr)).toLowerCase();
          // Erros de REDE ou PROXY (não de API da Meta) não confirmam que o token
          // está morto — são falhas transitórias de infraestrutura. Nesses casos,
          // NÃO marcamos como error: a conta tentará novamente no próximo sync.
          const isNetworkError =
            refreshMsg.includes("fetch failed") ||
            refreshMsg.includes("econnreset") ||
            refreshMsg.includes("econnrefused") ||
            refreshMsg.includes("etimedout") ||
            refreshMsg.includes("socket") ||
            refreshMsg.includes("timeout") ||
            refreshMsg.includes("[proxy]") ||
            refreshMsg.includes("network") ||
            refreshMsg.includes("connection reset") ||
            refreshMsg.includes("smartproxy");
          console.warn(
            `[sync-all] Renovação falhou para @${acc.username}` +
            (isNetworkError ? " [erro de rede — não é token morto, não marcando como error]" : " [token morto]") +
            `: ${refreshMsg.slice(0, 120)}`
          );
          return {
            id: acc.id, user_id: acc.user_id, username: acc.username,
            ok: false,
            tokenError: !isNetworkError, // erro de rede ≠ token morto
            errorCode: err.code, errorMessage: err.message,
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

    // Fetch last post timestamp (non-critical) — usa activeToken (pode ter sido renovado acima).
    // APENAS no sync manual (force): o sync silencioso faz exatamente 1 GET por
    // conta (perfil). last_post_at já é alimentado de graça pelo próprio pipeline
    // de postagem para contas ativas.
    let lastPostAt: string | null = null;
    if (force) try {
      const mediaUrl =
        `${GRAPH}/${acc.ig_business_account_id}/media` +
        `?fields=timestamp&limit=1` +
        `&access_token=${encodeURIComponent(activeToken)}`;
      const mediaRes = await undiciFetch(
        mediaUrl,
        proxyInit(proxy, { signal: AbortSignal.timeout(15_000) }) as any
      );
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

export async function POST(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "true";
  // IDs já processados em chamadas anteriores desta mesma sessão de sync manual
  // (o botão "sincronizar todas" chama este endpoint repetidas vezes até esgotar
  // a fila). Sem isso, force=true faria toda chamada reprocessar as mesmas
  // primeiras contas do array, nunca avançando para as demais.
  const body = await request.json().catch(() => ({}));
  const excludeIds: string[] = Array.isArray((body as { excludeIds?: unknown }).excludeIds)
    ? (body as { excludeIds: string[] }).excludeIds
    : [];
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
    .select("id, username, user_id, ig_business_account_id, meta_access_token, fb_page_id, profile_refreshed_at, connected_at, proxy_url")
    .eq("user_id", user.id)
    .neq("health_status", "error")
    .not("ig_business_account_id", "is", null)
    .not("meta_access_token", "is", null);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ synced: 0, errors: 0, token_errors: 0, restored });
  }

  const stale = (accounts as unknown as AccountRow[]).filter((a) => {
    if (excludeIds.includes(a.id)) return false;
    // Sem proxy = sem sync (vale até no force): nenhuma requisição em nome da
    // conta sai pelo IP datacenter da Vercel.
    if (!a.proxy_url) return false;
    // Contas recém-conectadas (< 10 min) recebem grace period — a Meta precisa
    // de tempo para ativar o token em todos os seus servidores. Sem o grace period,
    // qualquer falha transitória nesse momento marcaria a conta como error
    // logo após a conexão, antes mesmo de ela postar qualquer coisa.
    // Vale mesmo em sync forçado pelo botão manual.
    if (a.connected_at) {
      const ageMs = Date.now() - new Date(a.connected_at).getTime();
      if (ageMs < NEW_ACCOUNT_GRACE_MS) {
        console.log(
          `[sync-all] @${a.username} conectada há ${Math.round(ageMs / 60_000)}min ` +
          `— grace period ativo, pulando sync.`
        );
        return false;
      }
      // Conta < 7 dias: NENHUM sync automático — janela mais sensível do risk
      // engine da Meta. Sync manual (force) continua permitido.
      if (!force && ageMs < NEW_ACCOUNT_SILENT_BLOCK_MS) return false;
    }
    if (force) return true;
    if (!a.profile_refreshed_at) return true;
    return Date.now() - new Date(a.profile_refreshed_at).getTime() > STALE_MS;
  });

  if (stale.length === 0) {
    return NextResponse.json({ synced: 0, errors: 0, token_errors: 0, restored, message: "Dados recentes." });
  }

  // Stagger das chamadas à API: processa em lotes de 2 com 3s entre lotes.
  // Chamadas simultâneas para todas as contas de uma vez fazem o Instagram ver
  // múltiplas requisições do mesmo App ID no mesmo instante → checkpoint em cascata.
  // Lotes menores + delay maior = ritmo humano mais convincente.
  const BATCH_SIZE = 2;
  const BATCH_DELAY_MS = 3_000;
  // Orçamento de tempo do handler inteiro — deixa margem de ~20s abaixo do
  // maxDuration=60 para sempre conseguir responder. Um `Promise.race` por lote
  // (não só um check ENTRE lotes) garante que, mesmo se um lote individual travar
  // além do esperado (proxy lento, retry de token), a função corta a espera e
  // responde com o que já tem — em vez de deixar a Vercel matá-la à força no meio,
  // o que deixaria o fetch do frontend pendurado sem resposta alguma para sempre.
  const HARD_DEADLINE_MS = 40_000;
  const startedAt = Date.now();
  const allSettled: PromiseSettledResult<SyncResult>[] = [];
  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > HARD_DEADLINE_MS) break;
    const batch = stale.slice(i, i + BATCH_SIZE);
    const batchPromise = Promise.allSettled(batch.map(acc => syncOne(acc, admin, force)));
    const timedOut = Symbol("timeout");
    const raceResult = await Promise.race([
      batchPromise,
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), HARD_DEADLINE_MS - elapsed)
      ),
    ]);
    if (raceResult === timedOut) break;
    allSettled.push(...raceResult);
    if (i + BATCH_SIZE < stale.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  const remaining = stale.length - allSettled.length;
  const processedIds = stale.slice(0, allSettled.length).map((a) => a.id);
  // Coleta todos os resultados ANTES de escrever — necessário para cascade detection
  const settled = allSettled;
  const results: SyncResult[] = settled.map((r) =>
    r.status === "fulfilled" ? r.value : { id: "", user_id: "", username: "", ok: false }
  );

  // Erros de infra (ex: "Failed to decrypt") são excluídos da detecção de cascata:
  // já são tratados como non-fatal individualmente e nunca marcam como error.
  // Denominador = TODAS as contas ativas do usuário, não só as stale deste run:
  // contas mortas nunca avançam profile_refreshed_at, então no sync silencioso
  // (sem force) o conjunto stale degenera para "só as mortas" e a cascata
  // dispararia falso positivo em todo run, sem nunca marcá-las como error.
  const tokenErrorResults = results.filter((r) => r.tokenError);
  const isCascade =
    tokenErrorResults.length >= MIN_CASCADE_COUNT &&
    tokenErrorResults.length >= Math.ceil(accounts.length * CASCADE_THRESHOLD);

  if (isCascade) {
    // Queda em cascata: App Meta desativado, secret rotacionado ou outage da API.
    // Não marcar nenhuma conta como error — evita destruir o painel inteiro por
    // um evento externo temporário.
    console.warn(
      `[sync-all] CASCATA detectada: ${tokenErrorResults.length}/${accounts.length} contas ativas com ` +
      `code=${tokenErrorResults[0]?.errorCode} — "${tokenErrorResults[0]?.errorMessage}". ` +
      `Nenhuma conta marcada como error.`
    );
    return NextResponse.json({
      synced: 0,
      errors: tokenErrorResults.length,
      token_errors: tokenErrorResults.length,
      restored,
      remaining,
      processed: allSettled.length,
      processedIds,
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

  return NextResponse.json({
    synced,
    errors,
    token_errors: tokenErrors,
    restored,
    remaining,
    processed: allSettled.length,
    processedIds,
  });
}

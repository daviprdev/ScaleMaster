// ---------------------------------------------------------------------------
// Saúde de conta — detecção PASSIVA pelo pipeline de postagem (2026-07-17).
//
// Filosofia: nenhum ping dedicado de saúde. As contas que importam já chamam a
// Meta API várias vezes por dia para postar (pelo proxy delas) — quando uma
// postagem falha com erro inequívoco de conta caída, é AQUI que ela fica
// vermelha. O sync de perfil (sync-all) vira apenas atualizador de métricas
// de painel, raro e sob demanda.
//
// Guardas contra os falsos positivos históricos do projeto:
//  1. Padrões ESTRITOS — só mensagens que a Meta usa exclusivamente para conta
//     caída/checkpoint/token morto. Erros de infra ("failed to decrypt",
//     "cannot parse access token") são explicitamente excluídos.
//  2. Cascata — se ≥ CASCADE_MIN_COUNT contas E ≥ CASCADE_RATIO das contas
//     tentadas no mesmo run falharem como "mortas", é evento de plataforma
//     (outage/app desativado): NENHUMA é marcada.
// ---------------------------------------------------------------------------

type AdminClient = any;

const CASCADE_MIN_COUNT = 4;
const CASCADE_RATIO = 0.6;

// Mensagens de infra da Meta que chegam com code=190 mas NÃO são token morto.
const INFRA_EXCLUSIONS = [
  "failed to decrypt",
  "could not decrypt",
  "cannot parse access token",
  "malformed access token",
];

// Padrões inequívocos de conta caída / token genuinamente morto.
const DEAD_ACCOUNT_PATTERNS = [
  // Checkpoint do Instagram — exige login manual via browser para liberar:
  "you cannot access the app till you log in",
  "log in to www.instagram.com and follow the instructions",
  "checkpoint",
  // Tokens genuinamente mortos:
  "invalid_token",
  "token has expired",
  "session has been invalidated",
  "invalid oauth access token",
  "not a confirmed user",
  "sessions for the user are not allowed",
  // Restrições permanentes de conta:
  "account has been restricted",
  "this action is blocked",
  "has been blocked from",
  "your account has been disabled",
  // Conta pessoal sem suporte à API de publicação:
  "unsupported request - method type: post",
];

export function isAccountDeadError(msg: string): boolean {
  const lower = msg.toLowerCase();
  if (INFRA_EXCLUSIONS.some((p) => lower.includes(p))) return false;
  return DEAD_ACCOUNT_PATTERNS.some((p) => lower.includes(p));
}

export interface DeadAccountCandidate {
  accountId: string;
  username: string;
  userId: string;
  reason: string;
}

// Marca contas como health_status='error' com guarda de cascata e registra o
// motivo real em failover_logs (alimenta o AccountHealthBanner do dashboard).
// `attemptedAccountCount` = nº de contas DISTINTAS que o run tentou usar — é o
// denominador da cascata.
export async function markDeadAccounts(
  admin: AdminClient,
  source: string,
  candidates: DeadAccountCandidate[],
  attemptedAccountCount: number
): Promise<{ cascade: boolean; marked: number }> {
  if (candidates.length === 0) return { cascade: false, marked: 0 };

  // Dedup por conta — a mesma conta pode falhar em vários posts no mesmo run.
  const unique = new Map<string, DeadAccountCandidate>();
  for (const c of candidates) if (!unique.has(c.accountId)) unique.set(c.accountId, c);
  const items = [...unique.values()];

  const ratio = items.length / Math.max(attemptedAccountCount, 1);
  if (items.length >= CASCADE_MIN_COUNT && ratio >= CASCADE_RATIO) {
    console.warn(
      `[${source}] CASCATA: ${items.length}/${attemptedAccountCount} contas com erro de conta caída ` +
      `no mesmo run (${(ratio * 100).toFixed(0)}%) — possível outage/app desativado. ` +
      `Nenhuma conta marcada. Contas: ${items.map((i) => "@" + i.username).join(", ")}`
    );
    return { cascade: true, marked: 0 };
  }

  let marked = 0;
  for (const item of items) {
    try {
      await admin
        .from("instagram_accounts")
        .update({ health_status: "error" })
        .eq("id", item.accountId)
        .neq("health_status", "error");
      // Awaited de propósito: fire-and-forget é cancelado quando a função
      // serverless responde (bug histórico do failover_logs em sync-all).
      const { error: logErr } = await admin.from("failover_logs").insert({
        user_id: item.userId,
        failed_account_id: item.accountId,
        backup_account_id: null,
        error_reason: `[${source}] ${item.reason.slice(0, 400)}`,
      });
      if (logErr) console.error(`[${source}] Falha ao gravar failover_log de @${item.username}:`, logErr.message);
      console.warn(
        `[${source}] 🔴 @${item.username} marcada como health_status=error ` +
        `("${item.reason.slice(0, 100)}"). Restaure em Failover após resolver.`
      );
      marked++;
    } catch (err) {
      console.warn(`[${source}] Falha ao marcar @${item.username} como error:`, err);
    }
  }
  return { cascade: false, marked };
}

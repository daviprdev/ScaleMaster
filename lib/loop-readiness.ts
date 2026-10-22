/**
 * lib/loop-readiness.ts — por que um Loop não consegue postar, em português.
 *
 * Motivo de existir: um Loop podia ficar "Ativo" na tela, bonito e verde, sem
 * postar nada por tempo indefinido. O `process-loops` detectava o problema
 * (pasta de mídia vazia, nenhuma conta válida) e fazia `return "skipped"` com
 * um `console.warn` — visível só nos logs do servidor. Do lado do usuário não
 * havia sintoma nenhum além do silêncio.
 *
 * Agora o mesmo motivo é usado em dois momentos:
 *
 *   1. ANTES de criar/editar o loop (`/api/loops`), recusando a configuração
 *      que já nasce impossível — é onde o problema custa mais barato;
 *   2. DEPOIS, no cron, gravado em `loops.last_skip_reason` e mostrado no card.
 *      Cobre o que muda com o tempo: a pasta esvaziada, as contas removidas.
 *
 * As mensagens dizem o que fazer, não só o que houve.
 */

export const LOOP_SKIP_REASONS = {
  noMediaFolder: () =>
    "Nenhuma pasta de mídia selecionada. Edite o loop e escolha a pasta com os vídeos que ele deve postar.",

  emptyMediaFolder: (folderName?: string | null) =>
    `A pasta de mídia${folderName ? ` "${folderName}"` : ""} não tem nenhum vídeo. ` +
    "Adicione vídeos pela Biblioteca (ou pelas Inspirações) para o loop ter o que postar.",

  mediaFolderMissing: () =>
    "A pasta de mídia do loop foi excluída. Edite o loop e escolha outra pasta.",

  noAccountsInFolder: (folderName?: string | null) =>
    `A pasta de contas${folderName ? ` "${folderName}"` : ""} não tem nenhuma conta ativa e saudável. ` +
    "Adicione contas à pasta, ou ative as que estão inativas em Contas.",

  noAccountsSelected: () =>
    "Nenhuma conta selecionada. Edite o loop e escolha as contas de destino.",

  allAccountsDown: () =>
    "Todas as contas do loop estão inativas ou com erro. Reative-as em Contas (ou em Failover) para o loop voltar a postar.",

  noVideoAvailable: () =>
    "Todas as contas já postaram todos os vídeos da pasta neste ciclo. Adicione vídeos novos à pasta para continuar.",

  allVideosPaused: (folderName?: string | null) =>
    `Todos os vídeos da pasta${folderName ? ` "${folderName}"` : ""} estão pausados na aba Fila. ` +
    "Reative algum vídeo na aba Fila para o loop voltar a postar.",
} as const;

export interface LoopReadinessInput {
  folderId: string | null | undefined;
  /** Quantos vídeos existem na pasta de mídia. */
  videoCount: number;
  /** Modo pasta: quantas contas ativas e saudáveis a pasta tem. */
  accountFolderId?: string | null;
  accountFolderAccountCount?: number;
  /** Modo contas específicas: quantas contas ativas e saudáveis foram escolhidas. */
  specificAccountCount?: number;
  folderName?: string | null;
  accountFolderName?: string | null;
}

export type LoopReadiness = { ok: true } | { ok: false; reason: string };

/**
 * Só o pedaço do cliente Supabase que esta checagem usa. Evita `any` solto —
 * as tabelas novas não estão nos tipos gerados do projeto.
 */
type CountResult = Promise<{ count: number | null }>;
type RowResult<T> = Promise<{ data: T | null }>;
interface SupabaseLike {
  from(table: string): {
    select(cols: string, opts?: { count: "exact"; head: boolean }): {
      eq(col: string, val: unknown): any;
      in(col: string, vals: unknown[]): any;
    };
  };
}

/**
 * Um Loop só consegue postar se tiver as duas pontas: vídeo para publicar e
 * conta onde publicar. Qualquer uma faltando é silêncio garantido.
 */
export function checkLoopReadiness(input: LoopReadinessInput): LoopReadiness {
  if (!input.folderId) {
    return { ok: false, reason: LOOP_SKIP_REASONS.noMediaFolder() };
  }
  if (!input.videoCount) {
    return { ok: false, reason: LOOP_SKIP_REASONS.emptyMediaFolder(input.folderName) };
  }

  if (input.accountFolderId) {
    if (!input.accountFolderAccountCount) {
      return { ok: false, reason: LOOP_SKIP_REASONS.noAccountsInFolder(input.accountFolderName) };
    }
    return { ok: true };
  }

  if (!input.specificAccountCount) {
    return { ok: false, reason: LOOP_SKIP_REASONS.noAccountsSelected() };
  }
  return { ok: true };
}

/**
 * Conta vídeos e contas de verdade no banco e devolve o motivo em português
 * quando o loop não teria como postar. Usado na criação e na edição.
 */
export async function checkCreateReadiness(
  anyAdmin: SupabaseLike,
  userId: string,
  params: { folderId: string | null; accountFolderId: string | null; accountIds: string[] }
) {
  const [videoCount, folderRow, folderAccountCount, accFolderRow, specificCount] = await Promise.all([
    params.folderId
      ? anyAdmin
          .from("videos_library")
          .select("id", { count: "exact", head: true })
          .eq("folder_id", params.folderId)
          .eq("user_id", userId)
          .then((r: { count: number | null }) => r.count ?? 0)
      : Promise.resolve(0),
    params.folderId
      ? anyAdmin.from("library_folders").select("name").eq("id", params.folderId).maybeSingle()
          .then((r: { data: { name: string } | null }) => r.data)
      : Promise.resolve(null),
    params.accountFolderId
      ? anyAdmin
          .from("instagram_accounts")
          .select("id", { count: "exact", head: true })
          .eq("folder_id", params.accountFolderId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .neq("health_status", "error")
          .then((r: { count: number | null }) => r.count ?? 0)
      : Promise.resolve(0),
    params.accountFolderId
      ? anyAdmin.from("account_folders").select("name").eq("id", params.accountFolderId).maybeSingle()
          .then((r: { data: { name: string } | null }) => r.data)
      : Promise.resolve(null),
    params.accountIds.length
      ? anyAdmin
          .from("instagram_accounts")
          .select("id", { count: "exact", head: true })
          .in("id", params.accountIds)
          .eq("user_id", userId)
          .eq("is_active", true)
          .neq("health_status", "error")
          .then((r: { count: number | null }) => r.count ?? 0)
      : Promise.resolve(0),
  ]);

  return checkLoopReadiness({
    folderId: params.folderId,
    videoCount,
    folderName: folderRow?.name ?? null,
    accountFolderId: params.accountFolderId,
    accountFolderAccountCount: folderAccountCount,
    accountFolderName: accFolderRow?.name ?? null,
    specificAccountCount: specificCount,
  });
}

/**
 * /api/cron/refresh-tokens
 *
 * Renova proativamente tokens Meta de TODAS as contas antes que expirem.
 * Roda a cada 12h para garantir que tokens de contas ociosas (não em loops/campanhas)
 * nunca expirem por falta de uso — o principal motivo de contas "caírem" sem serem usadas.
 *
 * Critérios para renovar:
 *   - token_expires_at IS NULL (token sem data de expiração salva — renovar preventivamente)
 *   - token_expires_at < now + 20 dias (dentro da janela de segurança)
 *   - health_status != 'error' (contas já marcadas não precisam de renovação)
 *   - meta_access_token NOT NULL (tem token para renovar)
 *
 * Em caso de FALHA na renovação: apenas loga — não marca a conta como error.
 * A conta será marcada como error somente pelo sync-all quando o token realmente morrer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { refreshMetaToken } from "@/lib/meta-refresh";

export const runtime = "nodejs";
export const maxDuration = 300;

const REFRESH_WINDOW_DAYS = 20;

interface AccountRow {
  id:               string;
  username:         string;
  user_id:          string;
  meta_access_token: string;
  fb_page_id:       string | null;
  token_expires_at: string | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron] AVISO: CRON_SECRET nao configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const threshold = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();

  // Busca contas que precisam de renovação
  const { data: accounts, error } = await (admin as any)
    .from("instagram_accounts")
    .select("id, username, user_id, meta_access_token, fb_page_id, token_expires_at")
    .neq("health_status", "error")
    .not("meta_access_token", "is", null)
    .or(`token_expires_at.is.null,token_expires_at.lt.${threshold}`)
    .limit(1000);

  if (error) {
    console.error("[refresh-tokens] Erro ao buscar contas:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!accounts?.length) {
    console.log("[refresh-tokens] Nenhuma conta precisa de renovação.");
    return NextResponse.json({ ok: true, renewed: 0, failed: 0 });
  }

  console.log(`[refresh-tokens] ${accounts.length} conta(s) para renovar token.`);

  let renewed = 0;
  let failed  = 0;

  // Processa em lotes de 2 com 5s entre lotes — tokens de múltiplas contas renovados
  // simultaneamente pelo mesmo App ID podem disparar checkpoint em cascata.
  const CHUNK_SIZE = 2;
  const CHUNK_DELAY_MS = 5_000;
  const chunks: AccountRow[][] = [];
  for (let i = 0; i < (accounts as AccountRow[]).length; i += CHUNK_SIZE) {
    chunks.push((accounts as AccountRow[]).slice(i, i + CHUNK_SIZE));
  }

  for (const [chunkIdx, chunk] of chunks.entries()) {
    if (chunkIdx > 0) await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
    await Promise.allSettled(
      chunk.map(async (acc) => {
        try {
          const { token, expiresAt } = await refreshMetaToken(
            acc.meta_access_token,
            acc.fb_page_id,
          );

          await (admin as any)
            .from("instagram_accounts")
            .update({
              meta_access_token: token,
              token_expires_at:  expiresAt.toISOString(),
            })
            .eq("id", acc.id);

          console.log(
            `[refresh-tokens] ✓ @${acc.username} — novo expiry: ${expiresAt.toISOString().slice(0, 10)}`
          );
          renewed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // NUNCA marcar como error aqui — só o sync-all faz isso após confirmação
          console.warn(`[refresh-tokens] ✗ @${acc.username} falhou: ${msg.slice(0, 120)}`);
          failed++;
        }
      })
    );
  }

  console.log(`[refresh-tokens] ■ Renovados: ${renewed}, Falhas: ${failed}`);
  return NextResponse.json({ ok: true, renewed, failed, total: accounts.length });
}


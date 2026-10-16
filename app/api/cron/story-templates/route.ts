import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createMediaContainerOnly,
  pollContainerStatusOnce,
  publishReadyContainer,
} from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { normalizeProcessingMode, resolveMediaUrlForMode } from "@/lib/video-processing";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sem essa guarda, vários templates ou muitas contas por template facilmente
// passam do timeout do cron e a execução é cortada no meio do loop — as contas
// ainda não alcançadas simplesmente não recebem o story naquele ciclo, sem
// nenhum erro registrado. Corta o processamento antes disso pra devolver uma
// resposta normal (o resto é pego no próximo ciclo, respeitando o claim).
const RUN_BUDGET_MS = 45_000;

interface TemplateRow {
  id: string;
  user_id: string;
  media_url: string;
  media_type: "image" | "video";
  interval_minutes: number;
  last_posted_at: string | null;
  status: "active" | "paused";
  video_processing_mode: string | null;
}

interface TargetAccountRow {
  account_id: string;
  instagram_accounts: {
    id: string;
    username: string;
    is_active: boolean;
    health_status: string;
    ig_business_account_id: string | null;
    meta_access_token: string | null;
    token_expires_at: string | null;
    fb_page_id: string | null;
  } | null;
}

// Reposta o mesmo template de Story em loop nas contas alvo, mantendo o story
// sempre ativo (expira em 24h na Meta). Segue o mesmo padrão de elegibilidade +
// claim atômico do process-loops, mas bem mais simples: 1 mídia fixa, sem pool
// de vídeos nem shuffle. Publica via createMediaContainerOnly/pollContainerStatusOnce
// /publishReadyContainer — as mesmas 3 funções já usadas por publish-scheduled —
// sem depender de publishViaMetaAPI (que é hardcoded para REELS).
export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();
  const now = new Date();
  const runStart = Date.now();

  const { data: templates } = await admin
    .from("story_templates")
    .select("id, user_id, media_url, media_type, interval_minutes, last_posted_at, status, video_processing_mode")
    .eq("status", "active");

  const eligible = ((templates ?? []) as TemplateRow[]).filter((t) => {
    if (!t.last_posted_at) return true;
    const nextRun = new Date(t.last_posted_at).getTime() + t.interval_minutes * 60_000;
    return now.getTime() >= nextRun;
  });

  if (eligible.length === 0) {
    return NextResponse.json({ processed: 0, message: "Nenhum template devido." });
  }

  const summary = { processed: 0, published: 0, failed: 0 };

  for (const template of eligible) {
    // ── Budget global ──────────────────────────────────────────────────────
    if (Date.now() - runStart > RUN_BUDGET_MS) {
      console.log(`[story-templates] ⏱ Budget esgotado — ${eligible.length - summary.processed} template(s) restantes ficam pro próximo ciclo.`);
      break;
    }

    // Claim atômico: condiciona no last_posted_at visto no fetch — evita que
    // duas invocações concorrentes do cron repostem o mesmo template 2x.
    let claimQuery = admin
      .from("story_templates")
      .update({ last_posted_at: now.toISOString() })
      .eq("id", template.id);
    claimQuery = template.last_posted_at === null
      ? claimQuery.is("last_posted_at", null)
      : claimQuery.eq("last_posted_at", template.last_posted_at);

    const { data: claimResult } = await claimQuery.select("id");
    if (!claimResult?.length) continue; // outra invocação já reivindicou

    summary.processed++;

    const { data: targets } = await admin
      .from("story_template_accounts")
      .select(
        "account_id, instagram_accounts(id, username, is_active, health_status, ig_business_account_id, meta_access_token, token_expires_at, fb_page_id)"
      )
      .eq("template_id", template.id);

    const errors: string[] = [];

    // Processamento de video: escolha explicita do usuario no template.
    // original -> a midia hospedada vai direto pra Meta (zero FFmpeg).
    // clean_metadata -> usa a variante preparada pelo cron process-videos; se
    // ainda nao estiver pronta, o template espera o proximo ciclo (o claim ja
    // foi feito, entao ele simplesmente reposta no intervalo seguinte).
    const templateMode = normalizeProcessingMode(template.video_processing_mode);
    const resolution = await resolveMediaUrlForMode(admin, {
      mode: templateMode,
      sourceUrl: template.media_url,
      userId: template.user_id,
      scope: `story-templates ${template.id.slice(0, 8)}`,
    });

    if (resolution.status === "pending") {
      console.log(`[story-templates] template ${template.id.slice(0, 8)}: ${resolution.reason} - aguardando.`);
      // Devolve o claim para que o template seja reprocessado no proximo ciclo
      // em vez de perder a janela inteira do intervalo.
      await admin
        .from("story_templates")
        .update({ last_posted_at: template.last_posted_at })
        .eq("id", template.id);
      continue;
    }

    if (resolution.status === "error") {
      // Preparo da versao limpa falhou em definitivo: o template NAO reposta com
      // a midia original. O claim e mantido (aguarda o proximo intervalo) e o
      // motivo fica visivel em last_error na tela de Stories.
      console.error(`[story-templates] template ${template.id.slice(0, 8)}: ${resolution.reason} - publicacao bloqueada.`);
      await admin
        .from("story_templates")
        .update({
          last_error: `[LIMPEZA DE METADADOS] ${resolution.reason}. Story nao publicado - a midia original nao substitui a versao limpa.`.slice(0, 500),
        })
        .eq("id", template.id);
      continue;
    }

    const mediaUrlToPost = resolution.url;

    for (const row of (targets ?? []) as unknown as TargetAccountRow[]) {
      if (Date.now() - runStart > RUN_BUDGET_MS) {
        console.log(`[story-templates] ⏱ Budget esgotado no meio do template ${template.id} — contas restantes ficam pro próximo ciclo.`);
        break;
      }

      const account = row.instagram_accounts;
      if (!account || !account.is_active || account.health_status === "error") continue;
      if (!account.ig_business_account_id || !account.meta_access_token) {
        errors.push(`@${account?.username ?? row.account_id}: sem credenciais Meta`);
        continue;
      }

      try {
        let token = account.meta_access_token;

        if (isTokenExpiringSoon(account.token_expires_at, 7)) {
          try {
            const refreshed = await refreshMetaToken(token, account.fb_page_id);
            await admin
              .from("instagram_accounts")
              .update({ meta_access_token: refreshed.token, token_expires_at: refreshed.expiresAt.toISOString() })
              .eq("id", account.id);
            token = refreshed.token;
          } catch {
            // segue com o token atual — pode ainda estar válido
          }
        }

        const creationId = await createMediaContainerOnly(
          account.ig_business_account_id,
          mediaUrlToPost,
          "",
          token,
          "STORIES"
        );

        // Poll simples — stories processam rápido, mas dá algumas tentativas.
        let finished = false;
        for (let i = 0; i < 4 && !finished; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 4_000));
          const pollStatus = await pollContainerStatusOnce(creationId, token);
          if (pollStatus === "finished") finished = true;
          else if (pollStatus === "error") throw new Error("Container retornou erro no processamento.");
        }
        if (!finished) throw new Error("Timeout aguardando processamento do container.");

        await publishReadyContainer(account.ig_business_account_id, creationId, token);
        summary.published++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`@${account.username}: ${msg}`);
        summary.failed++;
      }
    }

    await admin
      .from("story_templates")
      .update({ last_error: errors.length > 0 ? errors.join(" | ").slice(0, 500) : null })
      .eq("id", template.id);
  }

  return NextResponse.json(summary);
}


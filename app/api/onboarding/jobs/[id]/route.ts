import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encrypt";
import { parseProxyLine } from "@/lib/proxy-pool";
import { isUuid, validateDestinationUrl } from "@/lib/managed-links";
import {
  isOnboardingStage,
  nextStage,
  withStage,
  type OnboardingStage,
  type StageStatusMap,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_COLUMNS =
  "id, username, stage, stage_status, status, retry_count, retry_after, error_message, photo_url, magic_link, account_id, ig_user_id, created_at, updated_at, processed_at";

interface PatchBody {
  // retry: reenfileira a etapa atual (ou `stage`, se enviada).
  // skip:  marca a etapa atual como concluida manualmente e avanca.
  action?: "retry" | "skip";
  stage?: string;
  password?: string;
  two_factor?: string | null;
  proxy_url?: string;
  photo_url?: string | null;
  magic_link?: string | null;
}

// PATCH - retry manual de etapa, conclusao manual (skip) e edicao de dados.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase nao configurado" }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "id invalido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const { data: job, error: jobErr } = await supabase
    .from("onboarding_jobs")
    .select("id, stage, stage_status, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job nao encontrado." }, { status: 404 });

  // O cron esta executando uma etapa agora - editar no meio causaria corrida.
  if (job.status === "processing") {
    return NextResponse.json({ error: "Job em execucao neste momento. Tente em alguns minutos." }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};

  // Edicao de dados
  if (typeof body.password === "string") {
    if (!body.password.trim()) return NextResponse.json({ error: "senha vazia." }, { status: 400 });
    patch.password_enc = encrypt(body.password.trim());
  }
  if (body.two_factor !== undefined) {
    const value = typeof body.two_factor === "string" ? body.two_factor.replace(/\s+/g, "") : "";
    patch.two_factor_enc = value ? encrypt(value) : null;
  }
  if (typeof body.proxy_url === "string") {
    const parsed = parseProxyLine(body.proxy_url.trim());
    if (!parsed) return NextResponse.json({ error: "proxy_url em formato invalido." }, { status: 400 });
    patch.proxy_url_enc = encrypt(parsed);
  }
  for (const field of ["photo_url", "magic_link"] as const) {
    if (body[field] === undefined) continue;
    const raw = body[field];
    if (raw === null || (typeof raw === "string" && !raw.trim())) {
      patch[field] = null;
      continue;
    }
    const check = validateDestinationUrl(String(raw));
    if (!check.ok) return NextResponse.json({ error: `${field}: ${check.error}` }, { status: 400 });
    patch[field] = check.url;
  }

  // Acoes
  const currentStage = job.stage as OnboardingStage;
  const stageStatus = (job.stage_status ?? {}) as StageStatusMap;
  const nowIso = new Date().toISOString();

  if (body.action === "retry") {
    const target = body.stage ?? currentStage;
    if (!isOnboardingStage(target)) {
      return NextResponse.json({ error: "stage invalida." }, { status: 400 });
    }
    Object.assign(patch, {
      stage: target,
      stage_status: withStage(stageStatus, target, { state: "pending", reason: "Retry manual.", started_at: nowIso }),
      status: "pending",
      retry_count: 0,
      retry_after: nowIso,
      error_message: null,
      processed_at: null,
    });
  } else if (body.action === "skip") {
    if (job.status === "done") {
      return NextResponse.json({ error: "Job ja concluido." }, { status: 409 });
    }
    let map = withStage(stageStatus, currentStage, { state: "ok", reason: "Concluida manualmente." });
    const next = nextStage(currentStage);
    if (next) {
      map = withStage(map, next, { state: "pending", started_at: nowIso });
      Object.assign(patch, {
        stage: next,
        stage_status: map,
        status: "pending",
        retry_count: 0,
        retry_after: nowIso,
        error_message: null,
        processed_at: null,
      });
    } else {
      Object.assign(patch, {
        stage_status: map,
        status: "done",
        retry_count: 0,
        retry_after: null,
        error_message: null,
        processed_at: nowIso,
      });
    }
  } else if (body.action !== undefined) {
    return NextResponse.json({ error: "action invalida (use retry ou skip)." }, { status: 400 });
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  // .neq("status","processing") fecha a corrida com um claim do cron entre a
  // leitura acima e esta escrita.
  const { data: updated, error } = await supabase
    .from("onboarding_jobs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "processing")
    .select(SAFE_COLUMNS)
    .maybeSingle();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!updated) {
    return NextResponse.json({ error: "Job em execucao neste momento. Tente em alguns minutos." }, { status: 409 });
  }

  return NextResponse.json({ job: updated });
}

// DELETE - tira a conta da fila de onboarding.
//
// Escopo deliberado: apaga SO a linha de onboarding_jobs. Se a conta ja chegou
// a ser conectada (account_id preenchido), ela continua em instagram_accounts,
// postando normalmente - a unica FK aqui sai desta tabela (ON DELETE SET NULL)
// e nada referencia onboarding_jobs. Remover a fila nunca desconecta conta.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase nao configurado" }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "id invalido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { data: job, error: jobErr } = await supabase
    .from("onboarding_jobs")
    .select("id, username, status, account_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job nao encontrado." }, { status: 404 });

  // O cron esta rodando uma etapa agora: apagar no meio deixaria a chamada ao
  // python_server orfa, escrevendo num job que nao existe mais.
  if (job.status === "processing") {
    return NextResponse.json(
      { error: "Job em execucao neste momento. Tente em alguns minutos." },
      { status: 409 }
    );
  }

  // .neq fecha a corrida com um claim do cron entre a leitura e a escrita;
  // .select confirma a remocao - sem ele, 0 linhas afetadas (RLS, corrida)
  // voltariam como sucesso e a UI mentiria.
  const { data: removed, error } = await supabase
    .from("onboarding_jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "processing")
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!removed) {
    return NextResponse.json(
      { error: "Job em execucao neste momento. Tente em alguns minutos." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    username: job.username,
    // A UI avisa que a conta conectada nao foi tocada.
    account_kept: !!job.account_id,
  });
}

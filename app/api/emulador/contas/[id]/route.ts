import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt, encrypt } from "@/lib/encrypt";
import { editableFrom, mergeEdit, stepsAfterEdit } from "@/lib/emulador/editar-conta";
import { parseJobSteps, type NovaContaInput } from "@/lib/emulador/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Usuário logado + a conta dele (com os dados abertos), ou a resposta de erro. */
async function loadJob(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };

  const admin = getSupabaseAdmin();
  const { data: job, error } = await admin
    .from("emulator_jobs")
    .select("id, status, steps, input_enc")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!job) return { response: NextResponse.json({ error: "Conta não encontrada." }, { status: 404 }) };

  let input: NovaContaInput;
  try {
    input = JSON.parse(decrypt(job.input_enc as string)) as NovaContaInput;
  } catch {
    return { response: NextResponse.json({ error: "Não deu para abrir os dados dessa conta." }, { status: 500 }) };
  }
  return { admin, job, input };
}

// GET — dados para o formulário Editar dados (sem a senha e sem as credenciais da proxy).
export async function GET(_req: NextRequest, { params }: Params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  const loaded = await loadJob((await params).id);
  if ("response" in loaded) return loaded.response;
  return NextResponse.json(editableFrom(loaded.input));
}

// PATCH — salva os dados novos e devolve a conta para a fila. As etapas que
// dependem do que mudou rodam de novo (stepsAfterEdit); as outras são puladas.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { id } = await params;
  const loaded = await loadJob(id);
  if ("response" in loaded) return loaded.response;
  const { admin, job, input } = loaded;
  if (job.status !== "error" && job.status !== "queued") {
    return NextResponse.json({ error: "Só dá para editar conta na fila ou que parou." }, { status: 409 });
  }

  const merged = mergeEdit(input, body);
  if ("error" in merged) return NextResponse.json({ error: merged.error }, { status: 400 });
  const next = merged.value;

  const { data, error } = await admin
    .from("emulator_jobs")
    .update({
      input_enc: encrypt(JSON.stringify(next)),
      label: next.conta.usuario || next.conta.email,
      steps: stepsAfterEdit(parseJobSteps(job.steps), input, next),
      status: "queued",
      error: null,
      prompt: null,
      reply: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["error", "queued"])
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "A conta começou a rodar enquanto você editava." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

// DELETE — tira a conta da lista (e da fila, se ainda não começou). A
// instância criada no MuMu fica lá; apagar instância é com o dono no MuMu.
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await getSupabaseAdmin()
    .from("emulator_jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("status", "running")
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: "Conta não encontrada ou rodando agora (espere terminar ou falhar)." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

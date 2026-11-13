import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { FALTA_SQL_PASTAS, ehPastaFixa, normalizarPasta } from "@/lib/vps/pastas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { de, para } — renomeia a pasta: todas as contas dela (e as
// estruturações que iam mover para ela ao concluir) passam para o nome novo.
// Nome que já existe = as duas pastas viram uma só.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { de?: unknown; para?: unknown } | null;
  const de = normalizarPasta(body?.de);
  const para = normalizarPasta(body?.para);
  if (!de) return NextResponse.json({ error: "Pasta não informada." }, { status: 400 });
  if (!para) return NextResponse.json({ error: "Informe o nome novo da pasta." }, { status: 400 });
  if (ehPastaFixa(de)) return NextResponse.json({ error: "CRIADAS e FALHAS são pastas fixas e não podem ser renomeadas." }, { status: 400 });
  if (de === para) return NextResponse.json({ pasta: para, contas: 0 });

  const { data, error } = await getSupabaseAdmin().from("emulator_jobs").update({ pasta: para }).eq("user_id", user.id).eq("pasta", de).select("id, kind");
  if (isMissingSchemaError(error)) return NextResponse.json({ error: FALTA_SQL_PASTAS }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pasta: para, contas: (data ?? []).filter((j) => (j as { kind: string }).kind === "nova-conta").length });
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MIDIA_BUCKET, erroDaMidia, extensaoDoTipo, type MidiaUso } from "@/lib/emulador/atividade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — URL de upload assinada para uma mídia da Atividade (foto de perfil ou
// story). O arquivo vai do navegador direto ao Storage, igual à aba Stories; o
// servidor escolhe o caminho (emulador/<user_id>/<uuid>.<ext>) e só esse
// caminho é aceito depois em /api/emulador/atividades.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { uso?: unknown; type?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const uso: MidiaUso | null = body.uso === "foto" || body.uso === "story" ? body.uso : null;
  if (!uso) return NextResponse.json({ error: "Mídia inválida." }, { status: 400 });
  const type = String(body.type ?? "");
  const erro = erroDaMidia(uso, type, Number(body.size ?? 0));
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  const path = `emulador/${user.id}/${randomUUID()}${extensaoDoTipo(type)}`;
  const { data, error } = await getSupabaseAdmin().storage.from(MIDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: `Falha ao preparar o envio: ${error?.message ?? "sem resposta"}` }, { status: 500 });
  }
  return NextResponse.json({ path, token: data.token });
}

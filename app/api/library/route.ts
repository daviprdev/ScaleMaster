import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PAGE_SIZE = 16;

// GET /api/library — lista vídeos de uma pasta específica (folderId obrigatório)
// ?folderId=<uuid> → vídeos na pasta especificada
// ?page=N          → página N (0-indexed)
export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const folderId = req.nextUrl.searchParams.get("folderId");
  if (!folderId) {
    return NextResponse.json({ error: "folderId é obrigatório." }, { status: 400 });
  }

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") ?? "0", 10) || 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await getSupabaseAdmin()
    .from("videos_library")
    .select("*")
    .eq("folder_id", folderId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const videos = (data ?? []) as Array<Record<string, unknown>>;
  return NextResponse.json({
    videos,
    hasMore: videos.length === PAGE_SIZE,
    page,
  });
}

// PATCH /api/library — move vídeo para pasta (ou para raiz)
export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id, folder_id } = await req.json() as { id: string; folder_id: string | null };

  if (!id) {
    return NextResponse.json({ error: "'id' obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Confirma dono do vídeo antes de mover
  const { data: video } = await admin
    .from("videos_library")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!video) return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });

  // Se movendo para uma pasta específica, confirma que ela pertence ao usuário
  if (folder_id) {
    const { data: folder } = await admin
      .from("library_folders")
      .select("id")
      .eq("id", folder_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!folder) return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
  }

  const { error } = await admin
    .from("videos_library")
    .update({ folder_id: folder_id ?? null } as unknown as Record<string, unknown>)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/library — remove vídeo do Storage e do banco
export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { id?: string };
  try {
    body = await req.json() as { id?: string };
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const id = body.id;
  if (!id) {
    return NextResponse.json({ error: "Campo 'id' é obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // O storage_path é DERIVADO da linha do dono — nunca aceito do corpo da
  // requisição. Antes a rota apagava o caminho que o cliente mandasse depois de
  // conferir a posse apenas do `id`: bastava enviar um id próprio junto do
  // storage_path de outro usuário para apagar o arquivo alheio.
  const { data: video } = await admin
    .from("videos_library")
    .select("id, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; storage_path: string | null }>();

  if (!video) {
    return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
  }

  // Banco PRIMEIRO, Storage depois. Não existe transação entre Postgres e o
  // Storage, então a ordem define qual estado sobra se a função morrer no meio:
  //   banco → Storage : sobra ARQUIVO ÓRFÃO (invisível, recuperável pelo admin)
  //   Storage → banco : sobra REGISTRO QUEBRADO (vídeo que não abre para o usuário)
  // A segunda ordem é a que produziu o estado quebrado da Biblioteca.
  const { error: dbError } = await admin
    .from("videos_library")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const path = video.storage_path;
  if (path && !path.startsWith("direct/")) {
    const { error: storageError } = await admin.storage
      .from("videos-library")
      .remove([path]);

    if (storageError && !storageError.message.toLowerCase().includes("not found")) {
      // Registro já saiu: o arquivo vira órfão, tratável pela limpeza de admin.
      console.error("[library DELETE] arquivo ficou órfão no Storage:", storageError.message);
    }
  }

  return NextResponse.json({ success: true });
}

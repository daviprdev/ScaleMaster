import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/library — lista vídeos da biblioteca
// ?folderId=root   → apenas vídeos sem pasta (folder_id IS NULL)
// ?folderId=<uuid> → vídeos na pasta especificada
// sem parâmetro    → todos os vídeos
export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ videos: getMockVideos() });
  }

  const folderId = req.nextUrl.searchParams.get("folderId");

  const { data, error } = await getSupabaseAdmin()
    .from("videos_library")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let videos = (data ?? []) as Array<Record<string, unknown>>;
  if (folderId === "root") {
    videos = videos.filter(v => v.folder_id == null);
  } else if (folderId) {
    videos = videos.filter(v => v.folder_id === folderId);
  }

  return NextResponse.json({ videos });
}

// PATCH /api/library — move vídeo para pasta (ou para raiz)
export async function PATCH(req: NextRequest) {
  const { id, folder_id } = await req.json() as { id: string; folder_id: string | null };

  if (!id) {
    return NextResponse.json({ error: "'id' obrigatório." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const { error } = await getSupabaseAdmin()
    .from("videos_library")
    .update({ folder_id: folder_id ?? null } as unknown as Record<string, unknown>)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/library — remove vídeo do Storage e do banco
export async function DELETE(req: NextRequest) {
  const { id, storage_path } = await req.json() as {
    id: string;
    storage_path: string;
  };

  if (!id || !storage_path) {
    return NextResponse.json(
      { error: "Campos 'id' e 'storage_path' são obrigatórios." },
      { status: 400 }
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const admin = getSupabaseAdmin();

  const { error: storageError } = await admin.storage
    .from("videos-library")
    .remove([storage_path]);

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const { error: dbError } = await admin
    .from("videos_library")
    .delete()
    .eq("id", id);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ── Dados mockados ────────────────────────────────────────────
const GRADIENTS = [
  "from-violet-600 to-purple-800",
  "from-cyan-500 to-blue-700",
  "from-pink-500 to-rose-700",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-700",
  "from-indigo-500 to-violet-700",
  "from-red-500 to-pink-700",
  "from-teal-500 to-cyan-700",
];

function getMockVideos() {
  const owners = ["fitness_brasil", "travel_vibes", "receitas_faceis", "moda_style"];
  return Array.from({ length: 8 }, (_, i) => ({
    id: `mock_${i}`,
    filename: `reel_${owners[i % owners.length]}_ABC${i}XYZ_clean_${Date.now() - i * 3600000}.mp4`,
    original_url: `https://example.com/reel_${i}.mp4`,
    storage_path: `videos/reel_${i}.mp4`,
    public_url: `https://example.com/reel_${i}.mp4`,
    file_size: Math.floor(Math.random() * 80_000_000) + 5_000_000,
    owner_username: owners[i % owners.length],
    caption: `Conteúdo incrível número ${i + 1} — salvo da biblioteca do AutoScale!`,
    views: Math.floor(Math.random() * 900_000) + 10_000,
    likes: Math.floor(Math.random() * 50_000) + 500,
    comments: Math.floor(Math.random() * 2_000) + 20,
    duration: Math.floor(Math.random() * 55) + 5,
    created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
    gradient: GRADIENTS[i % GRADIENTS.length],
  }));
}

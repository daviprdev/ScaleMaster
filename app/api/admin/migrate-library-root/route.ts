import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/admin/migrate-library-root
// One-time migration: moves all videos with folder_id IS NULL to a per-user "Geral" folder.
// Admin-only.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  // Verify caller is admin
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: roleRow } = await getSupabaseAdmin()
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleRow?.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  // Find distinct user_ids with orphaned videos
  const { data: orphans, error: orphanErr } = await admin
    .from("videos_library")
    .select("user_id")
    .is("folder_id", null);

  if (orphanErr) return NextResponse.json({ error: orphanErr.message }, { status: 500 });

  const userIds = [...new Set((orphans ?? []).map((r: Record<string, unknown>) => r.user_id as string))].filter(Boolean);

  if (userIds.length === 0) {
    return NextResponse.json({ message: "Nenhum vídeo órfão encontrado. Migração desnecessária.", migrated: 0 });
  }

  let totalMigrated = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    // Find or create "Geral" folder for this user
    let folderId: string;

    const { data: existing } = await admin
      .from("library_folders")
      .select("id")
      .eq("user_id", userId)
      .eq("name", "Geral")
      .limit(1)
      .maybeSingle();

    if (existing) {
      folderId = existing.id as string;
    } else {
      const { data: created, error: createErr } = await admin
        .from("library_folders")
        .insert({ user_id: userId, name: "Geral" } as never)
        .select("id")
        .single();

      if (createErr || !created) {
        errors.push(`Erro ao criar pasta para ${userId}: ${createErr?.message}`);
        continue;
      }
      folderId = (created as Record<string, unknown>).id as string;
    }

    // Move all orphaned videos for this user to the folder
    const { count, error: updateErr } = await admin
      .from("videos_library")
      .update({ folder_id: folderId } as never)
      .eq("user_id", userId)
      .is("folder_id", null);

    if (updateErr) {
      errors.push(`Erro ao migrar vídeos de ${userId}: ${updateErr.message}`);
    } else {
      totalMigrated += count ?? 0;
    }
  }

  return NextResponse.json({
    message: `Migração concluída. ${totalMigrated} vídeos movidos para pastas "Geral".`,
    usersProcessed: userIds.length,
    migrated: totalMigrated,
    errors,
  });
}

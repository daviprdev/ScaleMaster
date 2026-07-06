import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: automations, error } = await admin
    .from("automations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Busca relações em paralelo
  const ids = (automations ?? []).map((a) => a.id);
  const [afRes, vfRes] = await Promise.all([
    ids.length
      ? admin.from("automation_account_folders").select("automation_id, folder_id, account_folders(id, name)").in("automation_id", ids)
      : { data: [] },
    ids.length
      ? admin.from("automation_video_folders").select("automation_id, folder_id, library_folders(id, name)").in("automation_id", ids)
      : { data: [] },
  ]);

  const afMap: Record<string, { id: string; name: string }[]> = {};
  for (const row of (afRes.data ?? [])) {
    const f = (row as any).account_folders;
    if (!f) continue;
    if (!afMap[row.automation_id]) afMap[row.automation_id] = [];
    afMap[row.automation_id].push({ id: f.id, name: f.name });
  }

  const vfMap: Record<string, { id: string; name: string }[]> = {};
  for (const row of (vfRes.data ?? [])) {
    const f = (row as any).library_folders;
    if (!f) continue;
    if (!vfMap[row.automation_id]) vfMap[row.automation_id] = [];
    vfMap[row.automation_id].push({ id: f.id, name: f.name });
  }

  // Conta posts pendentes, publicados hoje e próximo agendamento por automação
  const pendingCounts: Record<string, number> = {};
  const publishedToday: Record<string, number> = {};
  const nextPostAt: Record<string, string> = {};

  if (ids.length) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [pendingRes, publishedRes, nextRes] = await Promise.all([
      admin.from("scheduled_posts").select("campaign_id").in("campaign_id", ids).in("status", ["pending", "publishing"]),
      admin.from("scheduled_posts").select("campaign_id").in("campaign_id", ids).eq("status", "published").gte("scheduled_at", since24h),
      admin.from("scheduled_posts").select("campaign_id, scheduled_at").in("campaign_id", ids).eq("status", "pending").gte("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: true }),
    ]);

    for (const row of (pendingRes.data ?? [])) {
      pendingCounts[row.campaign_id] = (pendingCounts[row.campaign_id] ?? 0) + 1;
    }
    for (const row of (publishedRes.data ?? [])) {
      publishedToday[row.campaign_id] = (publishedToday[row.campaign_id] ?? 0) + 1;
    }
    for (const row of (nextRes.data ?? [])) {
      if (!nextPostAt[row.campaign_id]) nextPostAt[row.campaign_id] = row.scheduled_at;
    }
  }

  const result = (automations ?? []).map((a) => ({
    ...a,
    account_folders: afMap[a.id] ?? [],
    video_folders: vfMap[a.id] ?? [],
    pending_posts: pendingCounts[a.id] ?? 0,
    published_today: publishedToday[a.id] ?? 0,
    next_post_at: nextPostAt[a.id] ?? null,
  }));

  return NextResponse.json({ automations: result });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    name = "Nova automação",
    posts_per_day = 6,
    offset_seconds = 30,
    active = false,
    captions = [],
    auto_caption_enabled = false,
    auto_caption_type = null,
    account_folder_ids = [],
    video_folder_ids = [],
  } = body as {
    name?: string; posts_per_day?: number; offset_seconds?: number;
    active?: boolean; captions?: string[];
    auto_caption_enabled?: boolean; auto_caption_type?: string | null;
    account_folder_ids?: string[]; video_folder_ids?: string[];
  };

  const admin = getSupabaseAdmin();

  const { data: automation, error } = await admin
    .from("automations")
    .insert({ user_id: user.id, name: name.trim(), posts_per_day, offset_seconds, active, captions: captions.map((c: string) => c.trim()).filter(Boolean), auto_caption_enabled, auto_caption_type: auto_caption_enabled ? auto_caption_type : null })
    .select()
    .single();

  if (error || !automation) return NextResponse.json({ error: error?.message ?? "Erro ao criar" }, { status: 500 });

  await Promise.all([
    account_folder_ids.length
      ? admin.from("automation_account_folders").insert(account_folder_ids.map((fid: string) => ({ automation_id: automation.id, folder_id: fid })))
      : Promise.resolve(),
    video_folder_ids.length
      ? admin.from("automation_video_folders").insert(video_folder_ids.map((fid: string) => ({ automation_id: automation.id, folder_id: fid })))
      : Promise.resolve(),
  ]);

  return NextResponse.json({ automation }, { status: 201 });
}

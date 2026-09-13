import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeProcessingMode } from "@/lib/video-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TemplateRow {
  id: string;
  media_url: string;
  media_type: "image" | "video";
  interval_minutes: number;
  last_posted_at: string | null;
  last_error: string | null;
  status: "active" | "paused";
  created_at: string;
  source_account_id: string | null;
  instagram_accounts: { username: string } | null;
  story_template_accounts: { account_id: string; instagram_accounts: { username: string; avatar_url: string | null } }[];
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("story_templates")
    .select(
      "id, media_url, media_type, interval_minutes, last_posted_at, last_error, status, created_at, source_account_id, " +
      // FK explícita: story_templates chega em instagram_accounts por DOIS
      // caminhos (source_account_id e a tabela N:N story_template_accounts).
      // Sem o hint, o PostgREST devolve PGRST201 e a lista inteira dava 500.
      "instagram_accounts!story_templates_source_account_id_fkey(username), " +
      "story_template_accounts(account_id, instagram_accounts(username, avatar_url))"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: (data ?? []) as unknown as TemplateRow[] });
}

interface CreateBody {
  media_url: string;
  media_type: "image" | "video";
  source_account_id: string | null;
  account_ids: string[];
  interval_minutes?: number;
  video_processing_mode?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => null) as CreateBody | null;
  if (!body) return NextResponse.json({ error: "Body inválido." }, { status: 400 });

  const { media_url, media_type, source_account_id, account_ids, interval_minutes } = body;
  const processingMode = normalizeProcessingMode(body.video_processing_mode);

  if (!media_url) return NextResponse.json({ error: "Mídia obrigatória." }, { status: 400 });
  if (media_type !== "image" && media_type !== "video")
    return NextResponse.json({ error: "Tipo de mídia inválido." }, { status: 400 });
  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta alvo." }, { status: 400 });

  const admin = getSupabaseAdmin();

  const { data: ownedAccounts } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", user.id)
    .in("id", account_ids);
  const validAccountIds = (ownedAccounts ?? []).map((a: { id: string }) => a.id);
  if (!validAccountIds.length)
    return NextResponse.json({ error: "Nenhuma conta válida encontrada." }, { status: 400 });

  const { data: template, error: insertErr } = await admin
    .from("story_templates")
    .insert({
      user_id: user.id,
      source_account_id: source_account_id ?? null,
      media_url,
      media_type,
      interval_minutes: interval_minutes && interval_minutes > 0 ? interval_minutes : 1380,
      status: "active",
      last_posted_at: null,
      video_processing_mode: processingMode,
    })
    .select("id")
    .single();

  if (insertErr || !template) {
    return NextResponse.json({ error: insertErr?.message ?? "Falha ao criar template." }, { status: 500 });
  }

  const { error: linkErr } = await admin.from("story_template_accounts").insert(
    validAccountIds.map((accountId) => ({ template_id: template.id, account_id: accountId }))
  );
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  return NextResponse.json({ success: true, id: template.id });
}

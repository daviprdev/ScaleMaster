import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDestinationUrl } from "@/lib/managed-links";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS = "id, name, app_id, photo_url, story_media_url, story_link_url, highlight_title, created_at, updated_at";

interface TemplateInput {
  name?: unknown;
  app_id?: unknown;
  photo_url?: unknown;
  story_media_url?: unknown;
  story_link_url?: unknown;
  highlight_title?: unknown;
}

// GET - lista os templates do usuário
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ templates: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("onboarding_templates")
    .select(SAFE_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data ?? [] });
}

// POST - cria um novo template
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: TemplateInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Nome do template é obrigatório." }, { status: 400 });

  // Valida URLs opcionais
  const urlsToValidate = ["photo_url", "story_media_url", "story_link_url"] as const;
  const validatedUrls: Record<string, string | null> = {};

  for (const field of urlsToValidate) {
    const raw = body[field];
    if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) {
      validatedUrls[field] = null;
      continue;
    }
    const check = validateDestinationUrl(String(raw));
    if (!check.ok) return NextResponse.json({ error: `${field}: ${check.error}` }, { status: 400 });
    validatedUrls[field] = check.url;
  }

  const highlightTitle =
    typeof body.highlight_title === "string" && body.highlight_title.trim()
      ? body.highlight_title.trim().slice(0, 100)
      : null;

  const appId = typeof body.app_id === "string" && body.app_id.trim() ? body.app_id.trim() : null;

  // Se app_id foi passado, valida que pertence ao usuário
  if (appId) {
    const { data: app } = await supabase
      .from("user_meta_apps")
      .select("id")
      .eq("id", appId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!app) return NextResponse.json({ error: "App não encontrado ou não pertence ao usuário." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("onboarding_templates")
    .insert({
      user_id: user.id,
      name,
      app_id: appId,
      photo_url: validatedUrls.photo_url,
      story_media_url: validatedUrls.story_media_url,
      story_link_url: validatedUrls.story_link_url,
      highlight_title: highlightTitle,
    })
    .select(SAFE_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template: data }, { status: 201 });
}
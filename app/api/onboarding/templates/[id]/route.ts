import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDestinationUrl } from "@/lib/managed-links";
import { isUuid } from "@/lib/managed-links";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS = "id, name, app_id, photo_url, story_media_url, story_link_url, highlight_title, created_at, updated_at";

interface PatchBody {
  name?: unknown;
  app_id?: unknown;
  photo_url?: unknown;
  story_media_url?: unknown;
  story_link_url?: unknown;
  highlight_title?: unknown;
}

// PATCH - atualiza um template existente
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  // Verifica se o template existe e pertence ao usuário
  const { data: existing, error: existErr } = await supabase
    .from("onboarding_templates")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Nome do template não pode ser vazio." }, { status: 400 });
    patch.name = name;
  }

  if (body.app_id !== undefined) {
    const appId = typeof body.app_id === "string" && body.app_id.trim() ? body.app_id.trim() : null;
    if (appId) {
      const { data: app } = await supabase
        .from("user_meta_apps")
        .select("id")
        .eq("id", appId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!app) return NextResponse.json({ error: "App não encontrado ou não pertence ao usuário." }, { status: 404 });
    }
    patch.app_id = appId;
  }

  // Valida URLs opcionais
  const urlsToValidate = ["photo_url", "story_media_url", "story_link_url"] as const;
  for (const field of urlsToValidate) {
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

  if (body.highlight_title !== undefined) {
    patch.highlight_title =
      typeof body.highlight_title === "string" && body.highlight_title.trim()
        ? body.highlight_title.trim().slice(0, 100)
        : null;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("onboarding_templates")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(SAFE_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template: data });
}

// DELETE - remove um template
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("onboarding_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

  return NextResponse.json({ success: true });
}
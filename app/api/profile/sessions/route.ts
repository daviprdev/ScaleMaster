import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const lower = ua.toLowerCase();

  const device = /ipad/i.test(ua)
    ? "tablet"
    : /mobile|android|iphone/i.test(ua)
    ? "mobile"
    : "desktop";

  const browser = /edg\//i.test(lower)
    ? "Edge"
    : /opr\/|opera/i.test(lower)
    ? "Opera"
    : /chrome\/[\d]+/i.test(lower)
    ? "Chrome"
    : /firefox\/[\d]+/i.test(lower)
    ? "Firefox"
    : /safari\/[\d]+/i.test(lower) && !/chrome/i.test(lower)
    ? "Safari"
    : "Navegador";

  const os = /windows nt/i.test(ua)
    ? "Windows"
    : /iphone|ipad/i.test(ua)
    ? "iOS"
    : /mac os x|macos/i.test(ua)
    ? "macOS"
    : /android/i.test(ua)
    ? "Android"
    : /linux/i.test(ua)
    ? "Linux"
    : "Sistema";

  return { browser, os, device };
}

// POST — Registra / atualiza a sessão atual do usuário
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const ua = req.headers.get("user-agent") ?? "";
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  // Vercel injeta esses headers automaticamente em produção
  const country = req.headers.get("x-vercel-ip-country") ?? null;
  const city    = req.headers.get("x-vercel-ip-city")    ?? null;

  const { browser, os, device } = parseUserAgent(ua);
  // Fingerprint estável: hash do UA + IP (sem exigir cookies adicionais)
  const fingerprint = createHash("sha256")
    .update(ua + (ip ?? ""))
    .digest("hex")
    .slice(0, 16);

  const admin = getSupabaseAdmin();
  const { data, error } = await (admin as any)
    .from("user_sessions")
    .upsert(
      {
        user_id:            user.id,
        device_fingerprint: fingerprint,
        device_type:        device,
        browser,
        os,
        ip_address:   ip,
        country,
        city,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,device_fingerprint" }
    )
    .select("id")
    .single();

  if (error) {
    // Se a tabela ainda não existe (migration pendente), retorna graciosamente
    if (error.code === "42P01") {
      return NextResponse.json({ id: null, migration_pending: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: (data as { id: string }).id });
}

// GET — Lista todas as sessões do usuário
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await (admin as any)
    .from("user_sessions")
    .select(
      "id, device_type, browser, os, ip_address, country, city, created_at, last_seen_at"
    )
    .eq("user_id", user.id)
    .order("last_seen_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({ sessions: [], migration_pending: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data ?? [] });
}

// DELETE — Desconecta sessões
// ?scope=others  → revoga todos exceto a sessão atual (currentId obrigatório)
// ?scope=all     → revoga todos incluindo a sessão atual
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope     = searchParams.get("scope") ?? "others";
  const currentId = searchParams.get("currentId");

  const admin = getSupabaseAdmin();

  if (scope === "all") {
    // Remove todos os registros do banco e invalida todas as sessões Supabase
    await (admin as any)
      .from("user_sessions")
      .delete()
      .eq("user_id", user.id);
    await supabase.auth.signOut({ scope: "global" });
    return NextResponse.json({ ok: true, redirect: "/auth/login" });
  }

  // scope === 'others': remove todos exceto o atual e invalida as demais sessões
  if (currentId) {
    await (admin as any)
      .from("user_sessions")
      .delete()
      .eq("user_id", user.id)
      .neq("id", currentId);
  }
  await supabase.auth.signOut({ scope: "others" });
  return NextResponse.json({ ok: true });
}

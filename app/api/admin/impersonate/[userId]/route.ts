import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rd } = await supabase
    .from("user_roles").select("role").eq("user_id", adminUser.id).single();
  if (rd?.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (userId === adminUser.id)
    return NextResponse.json({ error: "Não é possível impersonar a si mesmo" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: targetData, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr || !targetData.user?.email)
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetEmail = targetData.user.email;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: targetEmail,
    options: { redirectTo: `${appUrl}/auth/callback?next=/dashboard` },
  });

  if (linkErr || !linkData?.properties?.action_link)
    return NextResponse.json({ error: "Erro ao gerar link de acesso" }, { status: 500 });

  await logAudit({
    action: "impersonation_started",
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    targetId: userId,
    targetEmail,
  });

  const response = NextResponse.json({ actionLink: linkData.properties.action_link });
  response.cookies.set("admin-impersonating", JSON.stringify({ adminEmail: adminUser.email ?? "" }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 2,
    path: "/",
  });
  return response;
}

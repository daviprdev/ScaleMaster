import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMetaApps } from "@/lib/meta-apps";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico das variáveis do Meta OAuth — visível apenas para admins.
 * Nunca expõe client_secret.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const redirectUri = appUrl ? `${appUrl}/api/meta/callback` : null;
  const apps = getMetaApps().map((a) => ({ id: a.id, name: a.name, clientId: a.clientId }));

  return NextResponse.json({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "(não definida)",
    redirectUri: redirectUri ?? "(NEXT_PUBLIC_APP_URL ausente → usará http://localhost:3000)",
    appsConfigured: apps.length,
    apps,
    isLocalhost: appUrl.includes("localhost"),
    warning: appUrl.includes("localhost")
      ? "NEXT_PUBLIC_APP_URL aponta para localhost. Em produção a redirect_uri será rejeitada pelo Instagram."
      : null,
  });
}

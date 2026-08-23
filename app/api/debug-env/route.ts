import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Rota exclusiva de diagnóstico — nunca redireciona, só retorna JSON.
// Restrita a admins: expõe qual App/URL de OAuth seria gerada em produção.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID ?? "(não definida)";
  const igAppId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID ?? "(não definida)";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "(não definida)";
  const redirectUri = "https://autoscale-ia.vercel.app/api/instagram/callback";
  const scope = "instagram_business_basic,instagram_business_content_publish,instagram_manage_comments,instagram_manage_insights";

  const oauthUrl =
    "https://www.instagram.com/oauth/authorize" +
    "?client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + scope +
    "&response_type=code" +
    "&state=DEBUG";

  return NextResponse.json({
    buildTimestamp: new Date().toISOString(),
    env: {
      NEXT_PUBLIC_META_CLIENT_ID: clientId,
      NEXT_PUBLIC_INSTAGRAM_APP_ID: igAppId,
      NEXT_PUBLIC_APP_URL: appUrl,
      META_CLIENT_SECRET: process.env.META_CLIENT_SECRET ? "✓ definida" : "✗ ausente",
    },
    oauthUrlQueSeriaGerada: oauthUrl,
  });
}

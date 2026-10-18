import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/app-url";

// Rota chamada pelo Supabase após confirmação de e-mail ou OAuth
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // No build standalone da VPS o request.url chega como http://0.0.0.0:3000
  // (HOSTNAME do container), então o origin dele mandava o usuário para um
  // endereço inacessível depois do login com Google.
  const origin = getAppUrl();
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Se um destino foi passado explicitamente, respeita — mas só caminho
      // interno: "/x" sim; "//evil.com", "@evil.com" ou "/\evil.com" não
      // (`${origin}${next}` com "@evil.com" vira https://scalemaster.tech@evil.com).
      if (explicitNext && /^\/(?![/\\])/.test(explicitNext)) {
        return NextResponse.redirect(`${origin}${explicitNext}`);
      }
      // Caso contrário, redireciona conforme o role
      const { data: { user } } = await supabase.auth.getUser();
      let dest = "/dashboard";
      if (user) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();
        if (roleData?.role === "admin") dest = "/admin";
      }
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=callback_failed`);
}

import { NextResponse } from "next/server";
import { createTokenClient } from "@/lib/supabase/token-client";
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
    // createTokenClient: com SUPABASE_SECRET_KEY a troca do código conta no
    // limite por IP do cliente, não no da VPS (ver lib/supabase/token-client).
    const supabase = await createTokenClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Se um destino foi passado explicitamente, respeita — mas só caminho
      // interno: "/x" sim; "//evil.com", "@evil.com" ou "/\evil.com" não
      // (`${origin}${next}` com "@evil.com" vira https://scalemaster.tech@evil.com).
      if (explicitNext && /^\/(?![/\\])/.test(explicitNext)) {
        return NextResponse.redirect(`${origin}${explicitNext}`);
      }
      // Admin também cai no dashboard; o painel admin abre pela barra lateral.
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=callback_failed`);
}

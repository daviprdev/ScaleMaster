import { isIP } from "node:net";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createClient } from "./server";

// Client SSR para as chamadas que o servidor faz ao endpoint de token do
// Supabase Auth (/auth/v1/token): login por username e troca do código PKCE
// no /auth/callback. Use só nessa chamada; o resto da rota fica nos clients de
// sempre.
//
// Sem isso, todas saem do IP da VPS e dividem o limite por IP do Supabase
// (150/5 min, o mesmo do refresh de sessão de todo mundo). Com uma chave
// secreta (sb_secret_...) e "IP Address Forwarding" ligado no projeto
// (Authentication > Rate Limits), o Supabase conta o limite pelo IP do header
// Sb-Forwarded-For. As chaves legadas anon/service_role não ativam isso.
//
// O IP vem do X-Real-IP, que o Nginx sempre sobrescreve com $remote_addr. O
// X-Forwarded-For não serve: o Nginx só acrescenta ao valor que o cliente
// mandou, então o primeiro item é forjável.
//
// Sem SUPABASE_SECRET_KEY (ou sem IP válido) cai no client SSR comum, com a
// anon key, como antes. Nos dois casos os cookies de sessão vão na resposta.

let warnedBadKey = false;

export async function createTokenClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) return createClient();
  if (!secretKey.startsWith("sb_secret_")) {
    if (!warnedBadKey) {
      warnedBadKey = true;
      console.warn("[supabase/token-client] SUPABASE_SECRET_KEY não é uma chave sb_secret_; usando a anon key");
    }
    return createClient();
  }

  const ip = (await headers()).get("x-real-ip")?.trim() ?? "";
  if (!isIP(ip)) return createClient();

  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    global: { headers: { "Sb-Forwarded-For": ip } },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Igual ao createClient: só Route Handlers podem setar cookies
        }
      },
    },
  });
}

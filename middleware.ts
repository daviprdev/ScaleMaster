import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getSession() decodifica o JWT localmente (sem chamada de rede), evitando
  // o delay de ~8s que getUser() causava ao validar o token via HTTP no Supabase.
  // A validação definitiva com getUser() já acontece no layout server-side do
  // dashboard — aqui só precisamos saber se existe sessão ativa para decidir
  // o redirect, não precisamos da garantia criptográfica do servidor.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const { pathname } = request.nextUrl;
  const isDashboard = pathname.startsWith("/dashboard");
  const isAuthPage = pathname.startsWith("/auth");
  const isApi = pathname.startsWith("/api");

  const isAdmin = pathname.startsWith("/admin");

  // Sem sessão tentando acessar o dashboard ou admin → redireciona para login
  if (!user && (isDashboard || isAdmin)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // Com sessão tentando acessar login/register → redireciona para dashboard
  if (user && isAuthPage && pathname !== "/auth/callback") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Usuário banido/pendente com sessão ativa não pode ser bloqueado só na UI do
  // dashboard — sem isso ele continua chamando qualquer rota /api diretamente
  // (inclusive publicar de verdade no Instagram) mesmo com a página bloqueada.
  // Crons/webhooks não têm cookie de sessão Supabase (usam CRON_SECRET), então
  // `user` fica null pra eles e este bloco nunca os afeta.
  if (user && isApi) {
    try {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role, account_status")
        .eq("user_id", user.id)
        .single();

      const role = (roleData as { role?: string; account_status?: string } | null)?.role;
      const accountStatus = (roleData as { role?: string; account_status?: string } | null)?.account_status;

      if (role !== "admin") {
        if (!roleData || accountStatus === "pending") {
          return NextResponse.json(
            { error: "Conta aguardando aprovação." },
            { status: 403 }
          );
        }
        // O botão "Banir" do admin grava role='banned' — sem olhar o role, um
        // banido com account_status ainda 'approved' seguia usando a API.
        if (accountStatus === "banned" || role === "banned") {
          return NextResponse.json(
            { error: "Conta banida." },
            { status: 403 }
          );
        }
      }
    } catch (err) {
      // Falha ao consultar o status (hiccup de rede/DB) não deve derrubar a API
      // inteira — a mesma checagem já roda no dashboard/layout.tsx como camada
      // primária; esta é defesa em profundidade.
      console.error("[middleware] Falha ao checar account_status:", err);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/auth/login",
    "/auth/register",
    "/api/:path*",
  ],
};

import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createTokenClient } from "@/lib/supabase/token-client";

export const runtime = "nodejs";

// POST /api/auth/login — login por nome de usuário, inteiro no servidor.
//
// O e-mail da conta nunca sai daqui: a rota acha o usuário pelo
// user_metadata.username, faz signInWithPassword com o client SSR (que grava os
// cookies de sessão na resposta) e devolve só ok ou um erro genérico. A rota
// antiga (/api/auth/resolve-username) devolvia o e-mail de qualquer username,
// sem login. Login por e-mail e Google continuam direto no navegador.
//
// O signInWithPassword usa createTokenClient: com SUPABASE_SECRET_KEY ele manda
// o IP do cliente no Sb-Forwarded-For e o Supabase conta o limite do endpoint
// de token por esse IP. Sem a chave, a chamada sai do IP da VPS e gasta o
// limite que o refresh de sessão de todo mundo usa. Limite de tentativas por
// IP fica no Nginx (zona sm_login).

const INVALID = "Usuário ou senha inválidos.";

// Toda resposta leva pelo menos isso. Username inexistente nem chega a chamar
// o Supabase Auth, então sem o piso o tempo de resposta diria se ele existe.
const MIN_RESPONSE_MS = 1000;

const PER_PAGE = 1000;
const MAX_PAGES = 50;

// user_metadata.username não é único (o settings grava sem checar). A senha
// desempata entre contas com o mesmo username, mas sem testar contra muitas.
const MAX_CANDIDATES = 3;

async function findUsersByUsername(username: string): Promise<User[]> {
  const admin = getSupabaseAdmin();
  const matches: User[] = [];
  // listUsers() sem paginação só lê a primeira página (50 usuários).
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    for (const u of data.users) {
      const name = u.user_metadata?.username;
      if (u.email && typeof name === "string" && name.trim().toLowerCase() === username) {
        matches.push(u);
      }
    }
    if (data.users.length < PER_PAGE) break;
  }
  return matches;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const reply = async (body: Record<string, unknown>, status: number) => {
    const wait = MIN_RESPONSE_MS - (Date.now() - startedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return NextResponse.json(body, { status });
  };

  let username = "";
  let password = "";
  try {
    const body = (await req.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === "string") username = body.username.trim().toLowerCase();
    if (typeof body.password === "string") password = body.password;
  } catch {
    // corpo inválido → cai na validação abaixo
  }

  if (!username || !password || username.length > 64 || password.length > 256) {
    return reply({ error: "Informe usuário e senha." }, 400);
  }

  let candidates: User[];
  try {
    candidates = await findUsersByUsername(username);
  } catch (err) {
    console.error("[auth/login] Falha ao listar usuários:", err instanceof Error ? err.message : err);
    return reply({ error: "Não foi possível entrar agora. Tente novamente." }, 500);
  }

  const supabase = await createTokenClient();
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: candidate.email!,
      password,
    });

    if (!error && data.user) {
      // Pelo admin: o client de token pode estar com a chave secreta, e não
      // está documentado se o PostgREST roda como o usuário nesse caso.
      const { data: roleData } = await getSupabaseAdmin()
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .single();
      return reply({ ok: true, redirect: roleData?.role === "admin" ? "/admin" : "/dashboard" }, 200);
    }

    if (error?.status === 429) {
      console.warn("[auth/login] Supabase Auth limitou as tentativas do servidor (429)");
      return reply({ error: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo." }, 429);
    }

    // Chave secreta errada ou revogada também volta erro (401) e, sem log,
    // viraria "senha inválida" para todo mundo.
    if (error && error.code !== "invalid_credentials") {
      console.warn(`[auth/login] Supabase Auth recusou o login: status=${error.status} code=${error.code}`);
    }
  }

  return reply({ error: INVALID }, 401);
}

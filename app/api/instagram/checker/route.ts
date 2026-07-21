import { NextResponse } from "next/server";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getProxyForAccount, proxyInit } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Limite por chamada — o frontend faz lotes menores para listas maiores.
const MAX_USERNAMES = 20;
const DELAY_MS = 900;

// App ID público usado pelo cliente web do Instagram (sem login necessário).
const IG_WEB_APP_ID = "936619743392459";

interface CheckerResult {
  username: string;
  status: "active" | "not_found" | "error";
  message: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  followers?: number;
  profile_pic_url?: string;
}

function sanitizeUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

async function checkOne(username: string, proxyAgent: ProxyAgent | null): Promise<CheckerResult> {
  try {
    const res = await undiciFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      proxyInit(proxyAgent, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "x-ig-app-id": IG_WEB_APP_ID,
          Accept: "*/*",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(12_000),
      }) as any
    );

    if (res.status === 404) {
      return {
        username,
        status: "not_found",
        message: "Não encontrada (banida, removida ou nunca existiu)",
      };
    }

    if (res.status === 429) {
      return {
        username,
        status: "error",
        message: "Instagram limitou as verificações — tente novamente em alguns minutos",
      };
    }

    if (!res.ok) {
      return { username, status: "error", message: `Instagram respondeu ${res.status}` };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        username,
        status: "error",
        message: "Resposta inesperada do Instagram (possível bloqueio temporário)",
      };
    }

    const json = (await res.json()) as { data?: { user?: Record<string, unknown> | null } };
    const igUser = json?.data?.user;

    if (!igUser) {
      return {
        username,
        status: "not_found",
        message: "Não encontrada (banida, removida ou nunca existiu)",
      };
    }

    const isPrivate = Boolean(igUser.is_private);
    const edgeFollowedBy = igUser.edge_followed_by as { count?: number } | undefined;

    return {
      username,
      status: "active",
      message: isPrivate ? "Ativa (perfil privado)" : "Ativa",
      full_name: (igUser.full_name as string) || undefined,
      is_private: isPrivate,
      is_verified: Boolean(igUser.is_verified),
      followers: edgeFollowedBy?.count,
      profile_pic_url: (igUser.profile_pic_url_hd as string) || (igUser.profile_pic_url as string) || undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro desconhecido";
    const timedOut = /abort|timeout/i.test(msg);
    return {
      username,
      status: "error",
      message: timedOut ? "Tempo esgotado ao verificar" : `Falha ao verificar: ${msg}`,
    };
  }
}

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let body: { usernames?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const rawList = Array.isArray(body.usernames) ? body.usernames : [];
  const usernames = Array.from(
    new Set(
      rawList
        .filter((u): u is string => typeof u === "string")
        .map(sanitizeUsername)
        .filter(Boolean)
    )
  ).slice(0, MAX_USERNAMES);

  if (usernames.length === 0) {
    return NextResponse.json({ error: "Nenhum usuário válido informado." }, { status: 400 });
  }

  // Empresta o proxy residencial de alguma conta do usuário para essa checagem
  // pontual — checar direto pelo IP datacenter da Vercel esbarra em 429 do
  // Instagram quase de imediato (mesma razão pela qual o pipeline de postagem
  // nunca sai pelo IP da Vercel). Não é vinculado a nenhuma conta específica.
  const admin = getSupabaseAdmin();
  let proxyAgent: ProxyAgent | null = null;
  try {
    const { data: candidates } = await admin
      .from("instagram_accounts")
      .select("id, proxy_url")
      .eq("user_id", user.id)
      .not("proxy_url", "is", null)
      .limit(5);
    const pool = (candidates ?? []) as { id: string; proxy_url: string | null }[];
    if (pool.length > 0) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      proxyAgent = getProxyForAccount(pick.id, pick.proxy_url);
    }
  } catch {
    proxyAgent = null;
  }

  const results: CheckerResult[] = [];
  for (let i = 0; i < usernames.length; i++) {
    results.push(await checkOne(usernames[i], proxyAgent));
    if (i < usernames.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + Math.random() * 400));
    }
  }

  return NextResponse.json({ results });
}

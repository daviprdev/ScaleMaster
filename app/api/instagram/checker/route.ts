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
const IG_ASBD_ID = "129477";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const GRAPH = "https://graph.instagram.com/v21.0";

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

interface IgSession {
  cookie: string;
  csrfToken: string;
}

interface HelperAccount {
  id: string;
  ig_business_account_id: string;
  meta_access_token: string;
  proxy_url: string | null;
}

function sanitizeUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

/**
 * O endpoint web_profile_info exige um cookie de sessão anônima válido
 * (csrftoken) — sem ele, o Instagram responde 400 Bad Request para toda
 * consulta, mesmo em perfis reais. Visita a home pública uma vez para
 * receber esse cookie e reaproveita em todas as consultas da mesma request.
 */
async function fetchIgSession(proxyAgent: ProxyAgent | null): Promise<IgSession | null> {
  try {
    const res = await undiciFetch(
      "https://www.instagram.com/",
      proxyInit(proxyAgent, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(12_000),
      }) as any
    );

    const setCookies =
      typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];

    if (setCookies.length === 0) return null;

    const cookiePairs = setCookies.map((c) => c.split(";")[0].trim());
    const cookie = cookiePairs.join("; ");
    const csrfPair = cookiePairs.find((c) => c.startsWith("csrftoken="));
    const csrfToken = csrfPair ? csrfPair.split("=")[1] : "";

    if (!csrfToken) return null;
    return { cookie, csrfToken };
  } catch {
    return null;
  }
}

async function checkOneAnonymous(
  username: string,
  proxyAgent: ProxyAgent | null,
  session: IgSession | null
): Promise<CheckerResult> {
  try {
    const res = await undiciFetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      proxyInit(proxyAgent, {
        headers: {
          "User-Agent": UA,
          "x-ig-app-id": IG_WEB_APP_ID,
          "x-asbd-id": IG_ASBD_ID,
          "x-requested-with": "XMLHttpRequest",
          ...(session ? { "x-csrftoken": session.csrfToken, Cookie: session.cookie } : {}),
          Accept: "*/*",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
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
        message: "Instagram limitou as verificações anônimas — tente novamente em alguns minutos",
      };
    }

    if (res.status === 401) {
      return {
        username,
        status: "error",
        message: "Instagram exigiu login para essa consulta (proteção anti-bot reforçada)",
      };
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return {
        username,
        status: "error",
        message: `Instagram respondeu ${res.status}${bodyText ? `: ${bodyText.slice(0, 140)}` : ""}`,
      };
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

/**
 * Fallback oficial via Meta Graph API (Business Discovery) — usa o token de
 * uma conta já conectada no SaaS para consultar dados públicos de OUTRA conta.
 * Não sofre bloqueio anti-bot (é tráfego autenticado da própria Meta), mas só
 * enxerga contas Business/Creator — não confirma nem descarta contas pessoais.
 * Retorna null quando o resultado é ambíguo (não dá pra saber se não existe
 * ou se só não é Business/Creator).
 */
async function businessDiscoveryFallback(
  username: string,
  helper: HelperAccount
): Promise<CheckerResult | null> {
  try {
    const fields = `business_discovery.username(${username}){username,followers_count,media_count,profile_picture_url}`;
    const url = `${GRAPH}/${helper.ig_business_account_id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(helper.meta_access_token)}`;

    // Graph API oficial: conexão direta (o proxy fica só para a consulta
    // anônima ao endpoint web do Instagram, que não é API oficial).
    const res = await undiciFetch(url, { signal: AbortSignal.timeout(12_000) });
    const json = (await res.json()) as {
      business_discovery?: { username?: string; followers_count?: number; profile_picture_url?: string };
      error?: { message?: string };
    };

    const bd = json?.business_discovery;
    if (bd?.username) {
      return {
        username,
        status: "active",
        message: "Ativa (confirmado via Meta API — conta Business/Creator)",
        followers: bd.followers_count,
        profile_pic_url: bd.profile_picture_url,
      };
    }

    return null;
  } catch {
    return null;
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

  const admin = getSupabaseAdmin();

  // Empresta o proxy residencial de alguma conta do usuário para a consulta
  // anônima — checar direto pelo IP datacenter da Vercel esbarra em bloqueio
  // do Instagram quase de imediato. Não é vinculado a nenhuma conta específica.
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

  // Sessão anônima (cookie csrftoken) — sem ela o Instagram responde 400 para
  // qualquer username, mesmo real. Buscada uma vez e reaproveitada no lote.
  const session = await fetchIgSession(proxyAgent);

  // Conta auxiliar com token Meta válido, para o fallback oficial via
  // Business Discovery quando a consulta anônima é bloqueada (401/429/erro).
  let helper: HelperAccount | null = null;
  try {
    const { data: helperCandidates } = await admin
      .from("instagram_accounts")
      .select("id, ig_business_account_id, meta_access_token, proxy_url")
      .eq("user_id", user.id)
      .eq("health_status", "online")
      .not("ig_business_account_id", "is", null)
      .not("meta_access_token", "is", null)
      .limit(5);
    const helperPool = (helperCandidates ?? []) as HelperAccount[];
    if (helperPool.length > 0) {
      helper = helperPool[Math.floor(Math.random() * helperPool.length)];
    }
  } catch {
    helper = null;
  }

  const results: CheckerResult[] = [];
  for (let i = 0; i < usernames.length; i++) {
    const username = usernames[i];
    let result = await checkOneAnonymous(username, proxyAgent, session);

    if (result.status === "error" && helper) {
      const fallback = await businessDiscoveryFallback(username, helper);
      if (fallback) {
        result = fallback;
      } else {
        result = {
          ...result,
          message: `${result.message} · Não foi possível confirmar via API oficial (perfil pode ser pessoal, oculto ou indisponível)`,
        };
      }
    }

    results.push(result);
    if (i < usernames.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS + Math.random() * 400));
    }
  }

  return NextResponse.json({ results });
}

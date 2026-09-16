import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encrypt";
import { parseProxyLine } from "@/lib/proxy-pool";
import { validateDestinationUrl } from "@/lib/managed-links";
import {
  ONBOARDING_STAGES,
  normalizeInstagramUsername,
  onboardingProgress,
  withStage,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fila de onboarding automatizado (Fase Onboarding 1/3).
// Segredos (senha, 2FA, proxy, sessao) NUNCA voltam ao browser: a listagem
// seleciona so colunas nao sensiveis e expoe flags has_*.

const MAX_JOBS_PER_REQUEST = 200;
// Espalha o inicio dos jobs de um lote ao longo de ~15 min.
const STAGGER_WINDOW_MS = 15 * 60_000;

const SAFE_COLUMNS =
  "id, username, stage, stage_status, status, retry_count, retry_after, error_message, photo_url, magic_link, account_id, ig_user_id, created_at, updated_at, processed_at";

interface JobInput {
  username?: unknown;
  password?: unknown;
  two_factor?: unknown;
  proxy_url?: unknown;
  photo_url?: unknown;
  magic_link?: unknown;
}

// GET - lista os jobs do usuario com progresso por etapa.
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ jobs: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("onboarding_jobs")
    .select(`${SAFE_COLUMNS}, proxy_url_enc, two_factor_enc, session_settings`)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobs = (data ?? []).map((row) => {
    const { proxy_url_enc, two_factor_enc, session_settings, ...safe } = row as Record<string, unknown>;
    return {
      ...safe,
      has_proxy: !!proxy_url_enc,
      has_two_factor: !!two_factor_enc,
      has_session: !!session_settings,
      stages: ONBOARDING_STAGES,
      progress: onboardingProgress(String(safe.stage), String(safe.status)),
    };
  });

  return NextResponse.json({ jobs });
}

// POST - cria jobs a partir de uma lista de contas.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase nao configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const list: JobInput[] | null = Array.isArray(body)
    ? body
    : Array.isArray((body as { jobs?: unknown })?.jobs)
      ? (body as { jobs: JobInput[] }).jobs
      : null;

  if (!list || list.length === 0) {
    return NextResponse.json({ error: "Envie uma lista de contas (array ou { jobs: [...] })." }, { status: 400 });
  }
  if (list.length > MAX_JOBS_PER_REQUEST) {
    return NextResponse.json({ error: `Maximo de ${MAX_JOBS_PER_REQUEST} contas por envio.` }, { status: 400 });
  }

  const rejected: { index: number; username: string | null; error: string }[] = [];
  const valid: {
    username: string;
    password: string;
    twoFactor: string | null;
    proxy: string;
    photoUrl: string | null;
    magicLink: string | null;
  }[] = [];
  const seen = new Set<string>();

  list.forEach((item, index) => {
    const username = normalizeInstagramUsername(item?.username);
    const reject = (error: string) => rejected.push({ index, username, error });

    if (!username) return reject("username invalido.");
    if (seen.has(username)) return reject("username repetido neste envio.");

    const password = typeof item.password === "string" ? item.password.trim() : "";
    if (!password) return reject("senha obrigatoria.");

    const proxyRaw = typeof item.proxy_url === "string" ? item.proxy_url.trim() : "";
    const proxy = proxyRaw ? parseProxyLine(proxyRaw) : null;
    if (!proxy) return reject("proxy_url obrigatorio e em formato valido (user:pass@host:porta, host:porta:user:pass ou http://...).");

    let photoUrl: string | null = null;
    if (typeof item.photo_url === "string" && item.photo_url.trim()) {
      const check = validateDestinationUrl(item.photo_url);
      if (!check.ok) return reject(`photo_url: ${check.error}`);
      photoUrl = check.url;
    }

    let magicLink: string | null = null;
    if (typeof item.magic_link === "string" && item.magic_link.trim()) {
      const check = validateDestinationUrl(item.magic_link);
      if (!check.ok) return reject(`magic_link: ${check.error}`);
      magicLink = check.url;
    }

    const twoFactor =
      typeof item.two_factor === "string" && item.two_factor.trim()
        ? item.two_factor.replace(/\s+/g, "")
        : null;

    seen.add(username);
    valid.push({ username, password, twoFactor, proxy, photoUrl, magicLink });
  });

  // Conta que ja tem onboarding em andamento nao ganha outro (dois logins
  // simultaneos na mesma conta). O indice unico parcial tambem garante isso.
  let toInsert = valid;
  if (valid.length) {
    const { data: active, error: activeErr } = await supabase
      .from("onboarding_jobs")
      .select("username")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .in("username", valid.map((v) => v.username));
    if (activeErr) return NextResponse.json({ error: activeErr.message }, { status: 500 });

    const activeSet = new Set((active ?? []).map((r) => String(r.username).toLowerCase()));
    toInsert = valid.filter((v) => {
      if (!activeSet.has(v.username)) return true;
      rejected.push({ index: -1, username: v.username, error: "ja existe onboarding em andamento para esta conta." });
      return false;
    });
  }

  if (!toInsert.length) {
    return NextResponse.json({ created: [], rejected }, { status: rejected.length ? 422 : 400 });
  }

  const now = Date.now();
  const step = toInsert.length > 1 ? STAGGER_WINDOW_MS / (toInsert.length - 1) : 0;
  const nowIso = new Date(now).toISOString();

  const rows = toInsert.map((v, i) => {
    // Jitter de ate 30% do passo para o espacamento nao ficar periodico.
    const jitter = step ? Math.floor(Math.random() * step * 0.3) : 0;
    return {
      user_id: user.id,
      username: v.username,
      stage: "invite",
      stage_status: withStage({}, "invite", { state: "pending", started_at: nowIso }),
      password_enc: encrypt(v.password),
      two_factor_enc: v.twoFactor ? encrypt(v.twoFactor) : null,
      proxy_url_enc: encrypt(v.proxy),
      photo_url: v.photoUrl,
      magic_link: v.magicLink,
      status: "pending",
      retry_after: new Date(now + Math.round(i * step) + jitter).toISOString(),
    };
  });

  const { data: created, error } = await supabase
    .from("onboarding_jobs")
    .insert(rows)
    .select(SAFE_COLUMNS);

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message, rejected }, { status });
  }

  return NextResponse.json({ created: created ?? [], rejected }, { status: 201 });
}

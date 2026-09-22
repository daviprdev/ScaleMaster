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
  "id, username, stage, stage_status, status, retry_count, retry_after, error_message, photo_url, magic_link, story_media_url, story_link_url, highlight_title, story_pk, account_id, ig_user_id, created_at, updated_at, processed_at";

interface JobInput {
  username?: unknown;
  password?: unknown;
  two_factor?: unknown;
  proxy_url?: unknown;
  photo_url?: unknown;
  magic_link?: unknown;
  story_media_url?: unknown;
  story_link_url?: unknown;
  highlight_title?: unknown;
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

  // Aceita template_id opcional: quando presente, os campos do template
  // preenchem os jobs que nao tiverem valor proprio (o CSV so tem credenciais).
  const templateId =
    typeof (body as { template_id?: unknown })?.template_id === "string"
      ? String((body as { template_id: string }).template_id).trim()
      : null;

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

  // Carrega o template (se informado) para aplicar photo/story/highlight/app.
  let template: {
    app_id: string | null;
    photo_url: string | null;
    story_media_url: string | null;
    story_link_url: string | null;
    highlight_title: string | null;
  } | null = null;
  if (templateId) {
    const { data: tpl, error: tplErr } = await supabase
      .from("onboarding_templates")
      .select("app_id, photo_url, story_media_url, story_link_url, highlight_title")
      .eq("id", templateId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 });
    if (!tpl) return NextResponse.json({ error: "Template nao encontrado." }, { status: 404 });
    template = tpl;
  }

  const rejected: { index: number; username: string | null; error: string }[] = [];
  const valid: {
    username: string;
    password: string;
    twoFactor: string | null;
    proxy: string;
    photoUrl: string | null;
    magicLink: string | null;
    storyMediaUrl: string | null;
    storyLinkUrl: string | null;
    highlightTitle: string | null;
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

    let storyMediaUrl: string | null = null;
    if (typeof item.story_media_url === "string" && item.story_media_url.trim()) {
      const check = validateDestinationUrl(item.story_media_url);
      if (!check.ok) return reject(`story_media_url: ${check.error}`);
      storyMediaUrl = check.url;
    }

    let storyLinkUrl: string | null = null;
    if (typeof item.story_link_url === "string" && item.story_link_url.trim()) {
      const check = validateDestinationUrl(item.story_link_url);
      if (!check.ok) return reject(`story_link_url: ${check.error}`);
      storyLinkUrl = check.url;
    }

    const highlightTitle =
      typeof item.highlight_title === "string" && item.highlight_title.trim()
        ? item.highlight_title.trim().slice(0, 100)
        : null;

    const twoFactor =
      typeof item.two_factor === "string" && item.two_factor.trim()
        ? item.two_factor.replace(/\s+/g, "")
        : null;

    seen.add(username);
    valid.push({ username, password, twoFactor, proxy, photoUrl, magicLink, storyMediaUrl, storyLinkUrl, highlightTitle });
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

  // Gera magic_link automatico a partir do app_id do template (se houver).
  // O token e unico por usuario — upsert garante que todas as contas do lote
  // usam o mesmo link (o callback vincula pelo cookie ig_oauth_magic_user_id).
  let autoMagicLink: string | null = null;
  if (template?.app_id) {
    const crypto = await import("crypto");
    const newToken = crypto.randomUUID();
    const { data: tokenRow } = await supabase
      .from("magic_add_tokens")
      .upsert(
        { user_id: user.id, app_id: template.app_id, token: newToken, updated_at: nowIso },
        { onConflict: "user_id" }
      )
      .select("token")
      .single();
    if (tokenRow?.token) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autoscale-ia.vercel.app").replace(/\/$/, "");
      autoMagicLink = `${appUrl}/add/${tokenRow.token}`;
    }
  }

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
      // Template preenche campos ausentes no CSV (que so tem credenciais).
      photo_url: v.photoUrl ?? template?.photo_url ?? null,
      magic_link: v.magicLink ?? autoMagicLink,
      story_media_url: v.storyMediaUrl ?? template?.story_media_url ?? null,
      story_link_url: v.storyLinkUrl ?? template?.story_link_url ?? null,
      highlight_title: v.highlightTitle ?? template?.highlight_title ?? null,
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

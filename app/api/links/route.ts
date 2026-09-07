import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { userOwnsAccount, userOwnsCampaign } from "@/lib/managed-links-db";
import {
  generateSlug,
  normalizeCustomSlug,
  validateDestinationUrl,
  CREATE_RATE_LIMIT_PER_HOUR,
  MAX_LINKS_PER_USER,
} from "@/lib/managed-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/links — lista e cria Links Gerenciáveis.
 *
 * O `user_id` SEMPRE vem da sessão. Nenhum campo de dono é aceito no corpo da
 * requisição, e todo vínculo (conta, campanha) é validado contra o que
 * pertence ao usuário antes de ser gravado.
 */

const PAGE_SIZE = 50;

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ links: [], total: 0, overview: null });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");           // active|paused|archived|all
  const page = Math.max(0, Number(searchParams.get("page") ?? 0) || 0);

  const admin = getSupabaseAdmin();

  let query = admin
    .from("managed_links")
    .select(
      "id, slug, name, destination_url, status, forward_query_params, " +
      "instagram_account_id, campaign_id, click_count, last_clicked_at, created_at, updated_at, " +
      "instagram_accounts(username)",
      { count: "exact" }
    )
    .eq("user_id", user.id);

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  } else if (!statusFilter) {
    // Padrão: arquivados ficam fora da lista (é a exclusão suave).
    query = query.neq("status", "archived");
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agregação server-side — nunca trazer linha de clique para o browser
  // (o PostgREST corta em 1000 sem avisar).
  const { data: overview } = await admin.rpc("get_managed_link_overview", {
    p_user_id: user.id,
    p_days: 30,
  });

  return NextResponse.json({
    links: data ?? [],
    total: count ?? 0,
    page,
    page_size: PAGE_SIZE,
    overview: overview ?? null,
  });
}

// ── POST ────────────────────────────────────────────────────────────────────

interface CreateBody {
  name?: string;
  destination_url?: string;
  custom_slug?: string;
  forward_query_params?: boolean;
  instagram_account_id?: string | null;
  campaign_id?: string | null;
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: CreateBody;
  try {
    body = await req.json() as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const destination = validateDestinationUrl(body.destination_url ?? "");
  if (!destination.ok) return NextResponse.json({ error: destination.error }, { status: 400 });

  const name = (body.name ?? "").trim().slice(0, 120) || null;
  const forward = body.forward_query_params === true;

  const admin = getSupabaseAdmin();

  // ── Anti-abuso: teto por hora e teto absoluto ────────────────────────────
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: recentCount }, { count: totalCount }] = await Promise.all([
    admin.from("managed_links").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", oneHourAgo),
    admin.from("managed_links").select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  if ((recentCount ?? 0) >= CREATE_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      { error: `Limite de ${CREATE_RATE_LIMIT_PER_HOUR} links por hora atingido. Tente novamente mais tarde.` },
      { status: 429 }
    );
  }
  if ((totalCount ?? 0) >= MAX_LINKS_PER_USER) {
    return NextResponse.json(
      { error: `Limite de ${MAX_LINKS_PER_USER} links por conta atingido.` },
      { status: 429 }
    );
  }

  // ── Vínculos: só o que pertence ao usuário ───────────────────────────────
  let accountId: string | null = null;
  if (body.instagram_account_id) {
    if (!await userOwnsAccount(admin, user.id, body.instagram_account_id))
      return NextResponse.json({ error: "Conta do Instagram inválida." }, { status: 400 });
    accountId = body.instagram_account_id;
  }

  let campaignId: string | null = null;
  if (body.campaign_id) {
    const owns = await userOwnsCampaign(admin, user.id, body.campaign_id);
    if (!owns) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
    campaignId = body.campaign_id;
  }

  // ── Slug ─────────────────────────────────────────────────────────────────
  const custom = body.custom_slug?.trim();
  let slugs: string[];
  if (custom) {
    const check = normalizeCustomSlug(custom);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    slugs = [check.slug];                       // custom não tem retentativa
  } else {
    // Colisão em base62 de 7 chars é improvável, não impossível — e o UNIQUE
    // do banco é quem decide, não a estatística.
    slugs = Array.from({ length: 6 }, () => generateSlug());
  }

  let created: Record<string, unknown> | null = null;
  let lastError = "";

  for (const slug of slugs) {
    const { data, error } = await admin
      .from("managed_links")
      .insert({
        user_id: user.id,
        slug,
        name,
        destination_url: destination.url,
        status: "active",
        forward_query_params: forward,
        instagram_account_id: accountId,
        campaign_id: campaignId,
      })
      .select("id, slug, name, destination_url, status, forward_query_params, " +
              "instagram_account_id, campaign_id, click_count, last_clicked_at, created_at, updated_at")
      .single();

    if (!error) { created = data as unknown as Record<string, unknown>; break; }

    lastError = error.message;
    // 23505 = unique_violation. Slug automático: tenta o próximo candidato.
    if (error.code !== "23505") break;
    if (custom) {
      return NextResponse.json(
        { error: "Esse slug já está em uso. Escolha outro." },
        { status: 409 }
      );
    }
  }

  if (!created) {
    console.error("[managed-link] falha ao criar:", lastError);
    return NextResponse.json({ error: lastError || "Não foi possível criar o link." }, { status: 500 });
  }

  // Histórico: a criação também é um evento auditável.
  const { error: histErr } = await admin.from("managed_link_history").insert({
    link_id: created.id as string,
    user_id: user.id,
    change_type: "created",
    old_destination_url: null,
    new_destination_url: destination.url,
  });
  if (histErr) console.error("[managed-link] histórico de criação falhou:", histErr.message);

  console.log(`[managed-link] created link=${(created.id as string).slice(0, 8)} slug=${created.slug}`);

  return NextResponse.json({ link: created });
}

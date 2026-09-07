import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { userOwnsAccount, userOwnsCampaign } from "@/lib/managed-links-db";
import { validateDestinationUrl, isUuid } from "@/lib/managed-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/links/[id] — detalhe, edição e exclusão de um link.
 *
 * IDOR: toda query traz `.eq("user_id", user.id)` junto com o id. Saber o UUID
 * de um link alheio não dá acesso a nada — a resposta é 404 (não 403, para não
 * confirmar que o id existe).
 *
 * O `old_destination_url` do histórico é SEMPRE lido do banco antes do UPDATE.
 * Nada do que o frontend mandar sobre o estado anterior é aceito.
 */

const SELECT_FIELDS =
  "id, slug, name, destination_url, status, forward_query_params, " +
  "instagram_account_id, campaign_id, click_count, last_clicked_at, created_at, updated_at";

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: link } = await admin
    .from("managed_links")
    .select(SELECT_FIELDS + ", instagram_accounts(username)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!link) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });

  const { data: history } = await admin
    .from("managed_link_history")
    .select("id, change_type, old_destination_url, new_destination_url, changed_at")
    .eq("link_id", id)
    .eq("user_id", user.id)
    .order("changed_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ link, history: history ?? [] });
}

// ── PATCH ───────────────────────────────────────────────────────────────────

interface PatchBody {
  name?: string | null;
  destination_url?: string;
  status?: "active" | "paused" | "archived";
  forward_query_params?: boolean;
  instagram_account_id?: string | null;
  campaign_id?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: PatchBody;
  try {
    body = await req.json() as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Estado anterior lido do banco — é a única fonte do old_destination_url.
  const { data: current } = await admin
    .from("managed_links")
    .select(SELECT_FIELDS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!current) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });

  const prev = current as unknown as {
    destination_url: string; status: string; name: string | null;
    forward_query_params: boolean;
  };

  const patch: Record<string, unknown> = {};
  const events: { change_type: string; old?: string | null; next?: string | null }[] = [];

  // Destino — o slug NUNCA muda: é o link já divulgado.
  if (body.destination_url !== undefined) {
    const check = validateDestinationUrl(body.destination_url);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    if (check.url !== prev.destination_url) {
      patch.destination_url = check.url;
      events.push({ change_type: "destination_changed", old: prev.destination_url, next: check.url });
    }
  }

  if (body.status !== undefined) {
    if (!["active", "paused", "archived"].includes(body.status))
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    if (body.status !== prev.status) {
      patch.status = body.status;
      events.push({
        change_type: body.status === "active" ? "activated"
          : body.status === "paused" ? "deactivated" : "archived",
      });
    }
  }

  if (body.name !== undefined) {
    const name = (body.name ?? "").trim().slice(0, 120) || null;
    if (name !== prev.name) {
      patch.name = name;
      events.push({ change_type: "renamed" });
    }
  }

  if (body.forward_query_params !== undefined) {
    const forward = body.forward_query_params === true;
    if (forward !== prev.forward_query_params) {
      patch.forward_query_params = forward;
      events.push({ change_type: "settings_changed" });
    }
  }

  if (body.instagram_account_id !== undefined) {
    if (body.instagram_account_id) {
      if (!await userOwnsAccount(admin, user.id, body.instagram_account_id))
        return NextResponse.json({ error: "Conta do Instagram inválida." }, { status: 400 });
      patch.instagram_account_id = body.instagram_account_id;
    } else {
      patch.instagram_account_id = null;
    }
  }

  if (body.campaign_id !== undefined) {
    if (body.campaign_id) {
      if (!await userOwnsCampaign(admin, user.id, body.campaign_id))
        return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
      patch.campaign_id = body.campaign_id;
    } else {
      patch.campaign_id = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ link: current, unchanged: true });
  }

  const { data: updated, error } = await admin
    .from("managed_links")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)     // ownership também no UPDATE, não só na leitura
    .select(SELECT_FIELDS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });

  if (events.length > 0) {
    const { error: histErr } = await admin.from("managed_link_history").insert(
      events.map((e) => ({
        link_id: id,
        user_id: user.id,
        change_type: e.change_type,
        old_destination_url: e.old ?? null,
        new_destination_url: e.next ?? null,
      }))
    );
    if (histErr) console.error("[managed-link] histórico falhou:", histErr.message);
  }

  console.log(`[managed-link] updated link=${id.slice(0, 8)} campos=${Object.keys(patch).join(",")}`);

  return NextResponse.json({ link: updated });
}

// ── DELETE ──────────────────────────────────────────────────────────────────

/**
 * Exclusão DEFINITIVA. Remove o link, todo o histórico e todos os cliques
 * (CASCADE) — e libera o slug para ser reutilizado, o que faz um link já
 * divulgado passar a apontar para outro lugar se alguém recriar o mesmo slug.
 *
 * Por isso a ação padrão da UI é ARQUIVAR (PATCH status=archived): o link para
 * de redirecionar (404), o slug continua reservado e o analytics é preservado.
 * Este DELETE existe para quem realmente quer apagar tudo, e a UI exige dois
 * cliques com o aviso explícito da perda dos dados.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data, error } = await getSupabaseAdmin()
    .from("managed_links")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 });

  console.log(`[managed-link] deleted link=${id.slice(0, 8)}`);
  return NextResponse.json({ success: true });
}

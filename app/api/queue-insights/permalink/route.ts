import { NextRequest, NextResponse } from "next/server";
// Endpoint oficial da Meta: conexão direta, sem proxy (mesma regra de lib/meta-insights).
import { fetch as undiciFetch } from "undici";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { UUID_RE } from "@/lib/queue-insights/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tokens do Instagram Login funcionam com graph.instagram.com (lib/meta-publish).
const GRAPH_API = "https://graph.instagram.com/v21.0";
const MEDIA_ID_RE = /^\d{1,40}$/;
const INSTAGRAM_URL_RE = /^https:\/\/(www\.)?instagram\.com\//i;

/**
 * GET /api/queue-insights/permalink — link do post no Instagram para o botão
 * "Ver no Instagram" do Raio-X.
 *
 * Aceita `media_id` + `account_id`, ou o post (`source` + `post_id`) — aí a
 * conta e o media_id saem da linha do post, já filtrada pelo dono. Pede o
 * `permalink` à Graph API com o token da conta; se a Meta não devolver, cai no
 * perfil da conta. O token nunca vai para o log.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  let mediaId = sp.get("media_id") ?? sp.get("mediaId");
  let accountId = sp.get("account_id") ?? sp.get("accountId");
  const postId = sp.get("post_id") ?? sp.get("postId");
  const source = sp.get("source");

  const admin = getSupabaseAdmin();

  if (postId) {
    if (!UUID_RE.test(postId) || (source !== "postar" && source !== "loop")) {
      return NextResponse.json({ error: "Post inválido." }, { status: 400 });
    }
    const { data: post } = await admin
      .from(source === "loop" ? "pending_containers" : "scheduled_posts")
      .select("account_id, media_id")
      .eq("id", postId)
      .eq("user_id", user.id)
      .maybeSingle();
    const row = post as { account_id: string | null; media_id: string | null } | null;
    if (!row?.account_id) return NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
    accountId = row.account_id;
    mediaId = row.media_id ?? mediaId;
  }

  if (!accountId || !UUID_RE.test(accountId)) {
    return NextResponse.json({ error: "Conta inválida." }, { status: 400 });
  }
  if (!mediaId || !MEDIA_ID_RE.test(mediaId)) {
    return NextResponse.json({ error: "Post sem media_id." }, { status: 400 });
  }

  const { data: accountRow } = await admin
    .from("instagram_accounts")
    .select("username, meta_access_token")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  const account = accountRow as { username: string | null; meta_access_token: string | null } | null;
  if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  const profileUrl = `https://www.instagram.com/${account.username ? `${encodeURIComponent(account.username)}/` : ""}`;
  if (!account.meta_access_token) return NextResponse.json({ permalink: profileUrl });

  try {
    const res = await undiciFetch(
      `${GRAPH_API}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(account.meta_access_token)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const body = (await res.json().catch(() => ({}))) as {
      permalink?: unknown;
      error?: { code?: number; type?: string };
    };
    if (res.ok && typeof body.permalink === "string" && INSTAGRAM_URL_RE.test(body.permalink)) {
      return NextResponse.json({ permalink: body.permalink });
    }
    console.warn(
      `[queue-insights/permalink] Meta não devolveu o link da media ${mediaId} | http=${res.status} | ` +
      `code=${body.error?.code ?? "-"} | type=${body.error?.type ?? "-"}`
    );
  } catch (e) {
    // Só o nome do erro: a mensagem do undici pode trazer a URL (com o token).
    console.warn(`[queue-insights/permalink] falha ao consultar a media ${mediaId}: ${(e as Error).name}`);
  }

  return NextResponse.json({ permalink: profileUrl });
}

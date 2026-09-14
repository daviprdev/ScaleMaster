import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeProcessingMode } from "@/lib/video-processing";
import { validateDestinationUrl, isUuid, publicLinkUrl } from "@/lib/managed-links";
import { storyStoragePathFromPublicUrl } from "@/lib/story-upload";

export const runtime = "nodejs";

interface PostNowBody {
  account_ids: string[];
  media_url: string;
  media_type: "image" | "video";
  video_processing_mode?: string; // "original" (padrao) | "clean_metadata"
  /** Link divulgado junto do Story. Um dos dois, nunca os dois. */
  managed_link_id?: string | null;
  story_link_url?: string | null;
}

// Publica 1 mídia como Story AGORA para as contas selecionadas. Reaproveita o
// pipeline já em produção: grava em scheduled_posts (post_type='story') com
// scheduled_at bem próximo de agora — o cron publish-scheduled (roda a cada 1
// min) já trata post_type='story' → mediaType STORIES na Meta API, com proxy
// por conta, retry e fingerprint de vídeo já embutidos. Não precisa duplicar
// nenhuma dessa lógica aqui.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: PostNowBody;
  try {
    body = await req.json() as PostNowBody;
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { account_ids, media_url, media_type } = body;
  // Imagens ignoram o modo na hora de publicar (nao ha stream copy de video),
  // mas a escolha e persistida do mesmo jeito para auditoria.
  const processingMode = normalizeProcessingMode(body.video_processing_mode);

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });
  if (!media_url)
    return NextResponse.json({ error: "Adicione uma mídia." }, { status: 400 });
  if (media_type !== "image" && media_type !== "video")
    return NextResponse.json({ error: "Tipo de mídia inválido." }, { status: 400 });

  const admin = getSupabaseAdmin();

  // ── Link do Story ────────────────────────────────────────────────────────
  // Com link gerenciado, a URL é DERIVADA DO SLUG no servidor: o que vai para
  // o Story é sempre a URL pública /r/{slug}, nunca o destination_url — é
  // exatamente isso que permite trocar o destino depois sem refazer nada.
  // Qualquer URL que o frontend mande junto de um managed_link_id é ignorada.
  let storyLinkUrl: string | null = null;
  let managedLinkId: string | null = null;

  if (body.managed_link_id) {
    if (!isUuid(body.managed_link_id))
      return NextResponse.json({ error: "Link inválido." }, { status: 400 });

    const { data: link } = await admin
      .from("managed_links")
      .select("id, slug, status")
      .eq("id", body.managed_link_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const row = link as { id: string; slug: string; status: string } | null;
    if (!row) return NextResponse.json({ error: "Link não encontrado." }, { status: 400 });
    if (row.status !== "active")
      return NextResponse.json({ error: "Esse link não está ativo." }, { status: 400 });

    managedLinkId = row.id;
    storyLinkUrl = publicLinkUrl(row.slug, new URL(req.url).origin);
  } else if (body.story_link_url) {
    const check = validateDestinationUrl(body.story_link_url);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    storyLinkUrl = check.url;
  }

  const { data: ownedAccounts } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", user.id)
    .in("id", account_ids);
  const validAccountIds = (ownedAccounts ?? []).map((a: { id: string }) => a.id);
  if (!validAccountIds.length)
    return NextResponse.json({ error: "Nenhuma conta válida encontrada." }, { status: 400 });

  // +5s: dá margem para o insert terminar antes do cron (que roda a cada 1 min) considerar a linha.
  // Stagger de 20s por conta: todas com o mesmo horário disparavam ~17 publicações
  // simultâneas no mesmo Meta App → "User is performing too many actions" em massa.
  const STAGGER_MS = 20_000;
  const base = Date.now() + 5_000;

  const rows = validAccountIds.map((accountId, i) => ({
    user_id: user.id,
    account_id: accountId,
    video_id: null,
    video_url: media_url,
    caption: "",
    scheduled_at: new Date(base + i * STAGGER_MS).toISOString(),
    status: "pending",
    campaign_id: null,
    post_type: "story",
    video_processing_mode: processingMode,
    story_link_url: storyLinkUrl,
    managed_link_id: managedLinkId,
  }));

  const { error } = await admin.from("scheduled_posts").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Garante que a mídia postada fique salva na biblioteca de Stories para reuso.
  // O registro em `story_media` acontece no upload, mas se aquele passo falhou (o
  // arquivo vai direto ao Storage pelo navegador), o usuário precisava re-subir o
  // mesmo arquivo toda vez. Postar um Story é prova de que a mídia existe e é do
  // usuário — então gravamos aqui também. Best-effort: nunca bloqueia a postagem.
  const storagePath = storyStoragePathFromPublicUrl(media_url, user.id);
  if (storagePath) {
    const { error: mediaErr } = await admin
      .from("story_media")
      .upsert(
        {
          user_id: user.id,
          storage_path: storagePath,
          public_url: media_url,
          media_type,
        },
        { onConflict: "user_id,storage_path", ignoreDuplicates: true }
      );
    if (mediaErr) console.error("[stories/post-now] erro ao salvar mídia na biblioteca:", mediaErr.message);
  }

  return NextResponse.json({ success: true, accounts: validAccountIds.length });
}

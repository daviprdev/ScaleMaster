import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, getUniqueCaptions, type AutoCaptionType } from "@/lib/auto-captions";
import {
  normalizeCaptionMode, resolveCaption, captionRejectionMessage,
} from "@/lib/reel-captions";
import { fetchVideoUsage, fetchAllRows } from "@/lib/video-history";
import { normalizeProcessingMode } from "@/lib/video-processing";

export const runtime = "nodejs";

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface DistributeBody {
  account_ids: string[];
  folder_id: string;
  video_count: number;            // -1 = todos, ou 10/20/50
  posts_per_day: number;          // 1–1440 (ignorado em burst_mode)
  start_at: string;               // ISO datetime (ignorado em burst_mode)
  captions: string[];
  auto_caption_type?: string;     // se presente, ignora captions e gera automaticamente
  caption_mode?: string;          // original | custom | none (ausente = custom)
  caption_strip_hashtags?: boolean;
  caption_strip_mentions?: boolean;
  account_stagger_seconds?: number | null; // null = cálculo automático
  burst_mode?: boolean;           // Modo Ciclo: todos os vídeos agendados para agora
  sync_folder_ids?: string[];     // pastas de contas cujas contas novas devem entrar sozinhas na campanha
  video_processing_mode?: string; // "original" (padrao) | "clean_metadata"
  share_to_feed?: boolean;        // true = Reels + grade | false = somente Reels
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, total_posts: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as DistributeBody;
  const { account_ids, folder_id, video_count, posts_per_day, start_at, captions, auto_caption_type, account_stagger_seconds, burst_mode, sync_folder_ids } = body;
  // Decisao de processamento congelada no momento do agendamento: mudar a
  // preferencia depois nao altera retroativamente posts ja criados.
  const processingMode = normalizeProcessingMode(body.video_processing_mode);
  // Só persiste quando veio um booleano de verdade — undefined mantém o
  // comportamento anterior (parâmetro não enviado à Meta).
  const shareToFeed = typeof body.share_to_feed === "boolean" ? body.share_to_feed : null;

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });
  if (!folder_id)
    return NextResponse.json({ error: "Selecione uma pasta de mídia." }, { status: 400 });
  if (!burst_mode && (!posts_per_day || posts_per_day < 1 || posts_per_day > 1440))
    return NextResponse.json({ error: "Posts por dia deve ser entre 1 e 1440." }, { status: 400 });
  if (!burst_mode && !start_at)
    return NextResponse.json({ error: "Informe a data e hora de início." }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Valida ownership de TODAS as contas antes de agendar qualquer post — impede
  // agendar/publicar em conta de outro usuário via account_id vazado/adivinhado.
  const { data: ownedAccountRows } = await admin
    .from("instagram_accounts")
    .select("id")
    .in("id", account_ids)
    .eq("user_id", user.id);
  const ownedAccountIds = new Set((ownedAccountRows ?? []).map((a: { id: string }) => a.id));
  const notOwnedAccounts = account_ids.filter((id) => !ownedAccountIds.has(id));
  if (notOwnedAccounts.length > 0) {
    return NextResponse.json(
      { error: "Uma ou mais contas não pertencem a este usuário." },
      { status: 403 }
    );
  }

  // Modo de legenda. Ausente = "custom" = comportamento histórico desta aba
  // (pool digitado ou legenda automática) — nenhuma campanha existente muda.
  const captionMode = normalizeCaptionMode(body.caption_mode);
  const stripHashtags = body.caption_strip_hashtags === true;
  const stripMentions = body.caption_strip_mentions === true;

  const isAutoCaption = !!auto_caption_type;
  const validCaptions = isAutoCaption ? [] : (captions ?? []).map(c => c.trim()).filter(Boolean);

  // Pré-gera legendas automáticas únicas se necessário (1 por post total)
  const autoType = (auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

  // Paginado: `.limit(10000)` não bypassa o teto de 1000 linhas do PostgREST —
  // uma pasta com mais de 1000 vídeos teria o excedente ignorado em silêncio.
  let allVideos: { id: string; public_url: string; caption: string | null }[];
  try {
    allVideos = await fetchAllRows<{ id: string; public_url: string; caption: string | null }>((from, to) =>
      admin
        .from("videos_library")
        .select("id, public_url, caption")
        .eq("folder_id", folder_id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error(`[distribute] ${(e as Error).message}`);
    return NextResponse.json({ error: "Falha ao ler a pasta de mídia." }, { status: 503 });
  }

  if (!allVideos.length)
    return NextResponse.json({ error: "Nenhum vídeo encontrado na pasta." }, { status: 400 });

  const maxVideos = video_count === -1
    ? allVideos.length
    : Math.min(video_count, allVideos.length);

  // Histórico por conta atravessando TODAS as origens (Postar/Clonar/Automatizar
  // via scheduled_posts + Loop via pending_containers). Antes, o subconjunto era
  // slice(0, N) fixo por created_at — toda campanha nova começava SEMPRE pelos
  // mesmos N vídeos mais antigos da pasta, repetindo o que a conta já postou.
  //
  // Lido pelo RPC agregado, NÃO por selects diretos: o PostgREST corta toda
  // resposta em 1000 linhas e o `.limit(100000)` que ficava aqui não bypassava
  // esse teto — com dezenas de milhares de linhas de histórico, a maior parte
  // (inclusive a mais recente) ficava invisível e o pool oferecia vídeos que a
  // conta já tinha postado.
  //
  // account_id → (video_id → vezes postado)
  let postedCount: Map<string, Map<string, number>>;
  try {
    postedCount = await fetchVideoUsage(admin, account_ids);
  } catch (e) {
    console.error(`[distribute] ${(e as Error).message}`);
    return NextResponse.json(
      { error: "Falha ao ler o histórico de vídeos das contas. Tente novamente." },
      { status: 503 }
    );
  }

  // Pool compartilhado ordenado por menor uso GLOBAL entre as contas selecionadas
  // (prioriza vídeo nunca postado por nenhuma delas), com desempate aleatório.
  const globalUsage = (videoId: string) => {
    let total = 0;
    for (const accountId of account_ids) total += postedCount.get(accountId)?.get(videoId) ?? 0;
    return total;
  };
  const sharedPool = fisherYates(allVideos).sort((a, b) => globalUsage(a.id) - globalUsage(b.id));
  const poolSize = sharedPool.length;

  // Atribuição em "quadrado latino": na rodada r, a conta de índice `ai` recebe
  // sharedPool[(ai + r) % poolSize]. Isso garante que, na MESMA rodada (mesmo
  // horário relativo entre as contas), nenhuma conta repete vídeo com outra —
  // desde que nº de contas <= tamanho do pool. E cada conta percorre até
  // poolSize vídeos distintos ao longo das rodadas, sem repetir os próprios.
  // Corrige o caso real (81 contas / 330 vídeos) em que o sorteio independente
  // por conta fazia o mesmo vídeo sair em várias contas na mesma janela de
  // horas — padrão de conteúdo duplicado que a Meta suprime no alcance.
  function videoForRound(accountIndex: number, round: number) {
    return sharedPool[(accountIndex + round) % poolSize];
  }

  const campaignId = randomUUID();
  // Distribui uniformemente ao longo de 24h (ignorado em burst_mode)
  const intervalMinutes = burst_mode ? 0 : Math.floor((24 * 60) / posts_per_day);
  // Modo Ciclo: tudo agendado para agora — o cron publish-scheduled drena a fila
  // no ritmo máximo do pipeline (lotes por minuto, retry/backoff da Meta intactos).
  const startTime = burst_mode ? Date.now() : new Date(start_at).getTime();

  const rows: object[] = [];
  // Vídeos que o modo "original" encontrou sem legenda — publicam SEM legenda
  // (sem fallback) e o total volta na resposta para a UI poder avisar.
  const semLegendaOriginal = new Set<string>();

  // Stagger entre contas: customizável ou proporcional ao intervalo (máx. 5 min).
  // Custom: exato, sem jitter — conta[i] posta em i × stagger_s segundos.
  // Auto: proporcional ao intervalo garantindo que todas as contas postem dentro da 1ª janela.
  const autoStaggerPerAccountMs = !burst_mode && account_ids.length > 1
    ? Math.min(5 * 60_000, Math.floor((intervalMinutes * 60_000 * 0.9) / (account_ids.length - 1)))
    : 0;

  // Burst: blocos SEQUENCIAIS por conta — conta[0] posta seu lote inteiro, depois
  // conta[1], depois conta[2]... O bloco dura maxVideos × 2s; stagger custom vira
  // o espaçamento mínimo entre o início de cada conta (nunca menor que o bloco,
  // para os lotes não se intercalarem na fila).
  const burstBlockMs = burst_mode
    ? Math.max((account_stagger_seconds ?? 0) * 1_000, maxVideos * 2_000)
    : 0;

  for (let ai = 0; ai < account_ids.length; ai++) {
    const accountId = account_ids[ai];
    const staggerMs = burst_mode
      ? ai * burstBlockMs
      : account_stagger_seconds
        ? ai * account_stagger_seconds * 1_000
        : ai * autoStaggerPerAccountMs;

    for (let vi = 0; vi < maxVideos; vi++) {
      const video = videoForRound(ai, vi);
      // Burst: 2s entre vídeos só para ordenação estável na fila (scheduled_at ASC)
      const slotMs = burst_mode ? vi * 2_000 : vi * intervalMinutes * 60_000;
      const scheduledAt = new Date(startTime + slotMs + staggerMs).toISOString();
      // Legenda do mecanismo histórico (pool ou automática). Só é usada
      // quando o modo é "custom".
      const customCaption = isAutoCaption
        ? getAutoCaption(autoType)
        : validCaptions.length > 0
          ? validCaptions[Math.floor(Math.random() * validCaptions.length)]
          : "";

      // SNAPSHOT: a legenda é resolvida AQUI, com o vídeo concreto já
      // escolhido, e o texto final vai para a linha. Vídeo A recebe a legenda
      // de A porque `video` é o vídeo daquela iteração. Editar o vídeo na
      // Biblioteca depois não muda este post.
      const resolucao = resolveCaption({
        mode: captionMode,
        originalCaption: video.caption,
        customCaption,
        stripHashtags,
        stripMentions,
      });

      // Erro ANTES de agendar — comprimento, hashtags e menções. Nada é
      // truncado nem removido em silêncio.
      if (!resolucao.validation.valid) {
        return NextResponse.json(
          {
            error: captionRejectionMessage(resolucao.validation, `vídeo ${video.id.slice(0, 8)}`),
            code: resolucao.validation.error?.code,
          },
          { status: 400 }
        );
      }
      if (resolucao.missingOriginal) semLegendaOriginal.add(video.id);

      rows.push({
        user_id: user.id,
        account_id: accountId,
        video_id: video.id,
        video_url: video.public_url,
        caption: resolucao.caption,
        caption_mode: captionMode,
        scheduled_at: scheduledAt,
        status: "pending",
        campaign_id: campaignId,
        video_processing_mode: processingMode,
        share_to_feed: shareToFeed,
      });
    }
  }

  // Insert em lotes de 500
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("scheduled_posts").insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sincronização com pasta(s) de contas: persiste a config da campanha para que
  // o cron sync-distribute-accounts possa matricular contas novas adicionadas
  // depois, sem precisar recriar a distribuição.
  if (Array.isArray(sync_folder_ids) && sync_folder_ids.length > 0) {
    const { error: syncErr } = await admin.from("distribute_campaigns").insert({
      id: campaignId,
      user_id: user.id,
      account_folder_ids: sync_folder_ids,
      video_folder_id: folder_id,
      video_count,
      posts_per_day: burst_mode ? 1 : posts_per_day,
      captions: isAutoCaption ? [] : validCaptions,
      auto_caption_enabled: isAutoCaption,
      auto_caption_type: isAutoCaption ? autoType : null,
      caption_mode: captionMode,
      caption_strip_hashtags: stripHashtags,
      caption_strip_mentions: stripMentions,
      account_stagger_seconds: account_stagger_seconds ?? null,
      burst_mode: !!burst_mode,
      video_processing_mode: processingMode,
      share_to_feed: shareToFeed,
    });
    if (syncErr) console.error("[distribute] erro ao salvar sync da campanha:", syncErr.message);
  }

  const times = rows.map((r) => (r as { scheduled_at: string }).scheduled_at).sort();

  return NextResponse.json({
    success: true,
    campaign_id: campaignId,
    total_posts: rows.length,
    accounts: account_ids.length,
    videos_per_account: maxVideos,
    days: burst_mode ? 1 : Math.ceil(maxVideos / posts_per_day),
    first_slot: times[0],
    last_slot: times[times.length - 1],
    caption_mode: captionMode,
    // Quantos vídeos distintos entraram sem legenda original (modo "original").
    // Publicam sem legenda — a UI usa isto para avisar depois de agendar.
    videos_sem_legenda_original: semLegendaOriginal.size,
  });
}

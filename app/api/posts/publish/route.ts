import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import {
  normalizeCaptionMode, resolveCaption, captionTooLongMessage,
} from "@/lib/reel-captions";

export const runtime = "nodejs";
export const maxDuration = 120;

export interface PostResult {
  account_id: string;
  username: string;
  status: "ok" | "error";
  media_id?: string;
  code?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    video_id: string;
    account_ids: string[];
    caption?: string;
    caption_mode?: string;
    caption_strip_hashtags?: boolean;
    caption_strip_mentions?: boolean;
  };

  const { video_id, account_ids, caption = "" } = body;
  // Ausente = "custom" = o texto da caixa, que é o comportamento de sempre.
  const captionMode = normalizeCaptionMode(body.caption_mode);

  if (!video_id || !account_ids?.length) {
    return NextResponse.json(
      { error: "Os campos 'video_id' e 'account_ids' são obrigatórios." },
      { status: 400 }
    );
  }

  // Modo mock sem Supabase
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    await new Promise(r => setTimeout(r, 1500));
    const results: PostResult[] = account_ids.map(id => ({
      account_id: id,
      username: "mock_user",
      status: "ok",
      media_id: `mock_${Date.now()}`,
    }));
    return NextResponse.json({ success: true, results, mock: true });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Usuário não autenticado." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // A legenda original vem do BANCO, com o filtro de dono na própria query.
  // O cliente manda só o id; nada impede alguém de mandar um id alheio, e o
  // `.eq("user_id", user.id)` é o que faz esse caso virar 404 em vez de
  // devolver a legenda de outro usuário.
  const { data: video, error: videoErr } = await admin
    .from("videos_library")
    .select("public_url, filename, caption")
    .eq("id", video_id)
    .eq("user_id", user.id)
    .single();

  if (videoErr || !video?.public_url) {
    return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
  }

  // Publicação imediata: a legenda é resolvida ANTES de qualquer chamada à
  // Meta. Em modo "original" o texto sai de videos_library.caption e o que
  // o cliente mandou em `caption` é ignorado.
  const resolucao = resolveCaption({
    mode: captionMode,
    originalCaption: (video as { caption?: string | null }).caption ?? null,
    customCaption: caption,
    stripHashtags: body.caption_strip_hashtags === true,
    stripMentions: body.caption_strip_mentions === true,
  });

  if (resolucao.overLimit) {
    return NextResponse.json(
      { error: captionTooLongMessage(resolucao.length) },
      { status: 400 }
    );
  }
  if (captionMode === "original" && resolucao.missingOriginal) {
    // Publicação individual: em vez de publicar sem legenda por engano, o
    // usuário é avisado e escolhe. (No Loop, com pasta mista, a regra é
    // outra e está documentada na própria UI.)
    return NextResponse.json(
      { error: "Este vídeo não tem legenda original disponível. Escolha \"Personalizada\" ou \"Sem legenda\"." },
      { status: 400 }
    );
  }

  const captionFinal = resolucao.caption;

  const { data: accounts, error: accsErr } = await admin
    .from("instagram_accounts")
    .select("id, username, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id")
    .in("id", account_ids)
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (accsErr || !accounts?.length) {
    return NextResponse.json({ error: "Nenhuma conta ativa encontrada." }, { status: 404 });
  }

  const results: PostResult[] = [];

  for (const account of accounts) {
    if (!account.meta_access_token || !account.ig_business_account_id) {
      results.push({
        account_id: account.id,
        username: account.username,
        status: "error",
        error: "Conta não conectada via Meta/Instagram. Reconecte a conta em Contas.",
      });
      continue;
    }

    let tokenToUse = account.meta_access_token;
    if (isTokenExpiringSoon(account.token_expires_at, 7)) {
      try {
        const { token, expiresAt } = await refreshMetaToken(account.meta_access_token, account.fb_page_id);
        await admin
          .from("instagram_accounts")
          .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
          .eq("id", account.id);
        tokenToUse = token;
        console.log(`[posts/publish] Token renovado automaticamente para @${account.username}`);
      } catch (refreshErr) {
        console.warn(`[posts/publish] Falha ao renovar token para @${account.username}:`, refreshErr);
      }
    }

    const metaResult = await publishViaMetaAPI(
      account.ig_business_account_id,
      tokenToUse,
      video.public_url,
      captionFinal
    );
    results.push({
      account_id: account.id,
      username: account.username,
      status: metaResult.status,
      media_id: metaResult.media_id,
      error: metaResult.error,
    });
  }

  const allOk = results.every(r => r.status === "ok");
  return NextResponse.json({ success: allOk, results });
}

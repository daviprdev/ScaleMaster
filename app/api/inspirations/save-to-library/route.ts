import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import {
  downloadOriginalMedia,
  buildLibraryStoragePath,
  toIntegerColumn,
} from "@/lib/media-ingest";

export const runtime = "nodejs";

// 300 s on Vercel Pro; Hobby is capped at 60 s regardless of this setting.
// Each video takes ~3–10 s (download + Storage upload — sem FFmpeg).
// Frontend sends batches of 3, so worst-case is ~30 s per request — safe on both plans.
export const maxDuration = 300;

interface SaveBody {
  reels: ReelPayload[];
  /** Pasta de destino OBRIGATÓRIA — sem ela o vídeo cairia em "Sem pasta". */
  folderId?: string | null;
}

interface ReelPayload {
  id: string;
  shortCode: string;
  videoUrl: string;
  /** Compat: o que a UI já mandava. "" quando não há legenda. */
  caption: string;
  /**
   * Legenda ORIGINAL crua vinda da normalização (lib/scraped-reel.ts).
   * null = o payload do Apify não trouxe o campo; "" = Reel sem legenda.
   * Quando ausente (payload antigo), cai para `caption`.
   */
  originalCaption?: string | null;
  /** Permalink da publicação original. */
  sourceUrl?: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
}

/**
 * Legenda que vai para o banco.
 *
 * NÃO trunca, não traduz, não resume, não reescreve, não mexe em emoji,
 * hashtag ou @menção. O `.slice(0, 500)` que existia aqui cortava a legenda
 * original pela metade — e antes dele o poller já tinha cortado em 120.
 *
 * Preserva a distinção de três estados: null (não capturada) continua null,
 * "" (Reel sem legenda) continua "".
 */
function captionParaBanco(reel: ReelPayload): string | null {
  if (reel.originalCaption !== undefined) return reel.originalCaption;
  return typeof reel.caption === "string" ? reel.caption : null;
}

// POST /api/inspirations/save-to-library
// Body: { reels: ReelPayload[] }
//
// INGESTÃO SEM ALTERAÇÃO (2026-09-06): o arquivo salvo na Biblioteca é o
// ORIGINAL baixado da fonte, byte a byte. Não roda FFmpeg, não remove
// metadados/SEI, não injeta creation_time, não re-encoda.
//   1. Download dos bytes originais do CDN
//   2. Upload dos MESMOS bytes para o Supabase Storage
//   3. Insert em videos_library apontando para o original
//
// A limpeza de metadados existe, mas só na CONFIGURAÇÃO DA PUBLICAÇÃO
// (video_processing_mode = "clean_metadata"), gerando uma VARIANTE separada
// — ver lib/video-processing.ts. O original permanece imutável.
//
// Processed sequentially to avoid parallel downloads hitting the timeout.
export async function POST(req: NextRequest) {
  let body: SaveBody;
  try {
    body = await req.json() as SaveBody;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const reels = Array.isArray(body.reels) ? body.reels : [];

  if (reels.length === 0) {
    return NextResponse.json({ error: "Lista de reels vazia." }, { status: 400 });
  }

  // Pasta de destino é OBRIGATÓRIA. A Biblioteca não tem mais "Sem pasta" — todo
  // vídeo precisa nascer dentro de uma pasta, senão fica invisível na UI.
  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";
  if (!folderId) {
    return NextResponse.json(
      { error: "Selecione uma pasta de destino antes de salvar." },
      { status: 400 }
    );
  }

  // Mock mode — no Supabase configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ saved: reels.length, errors: 0, records: [] });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // A pasta precisa existir E pertencer ao usuário (evita gravar em pasta alheia).
  const { data: folder } = await admin
    .from("library_folders")
    .select("id")
    .eq("id", folderId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();
  if (!folder) {
    return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
  }
  const savedRecords: unknown[] = [];
  let errors = 0;
  // Falhas por reel, para o frontend decidir o que renovar. `expired` = URL do
  // CDN morta (HTTP 403 / fetch failed) → recuperável via /refresh-urls numa
  // única run de Apify. `other` = erro que renovar a URL não resolve.
  const failures: { id: string; shortCode: string; reason: "expired" | "other" }[] = [];

  // Filter reels with no usable video URL before processing
  const valid = reels.filter(r =>
    r.videoUrl && r.videoUrl.trim() !== "" && r.videoUrl !== "undefined"
  );
  for (const r of reels) {
    if (!r.videoUrl || r.videoUrl.trim() === "" || r.videoUrl === "undefined") {
      errors++;
      failures.push({ id: r.id, shortCode: r.shortCode, reason: "expired" });
    }
  }

  // Process one reel at a time — sequential to respect serverless memory/timeout limits
  for (const reel of valid) {
    // Precisa viver fora do try: se o INSERT falhar, o arquivo JÁ subiu e
    // vira lixo permanente no Storage sem alguém para removê-lo.
    let uploadedPath: string | null = null;

    try {
      const baseName = `reel_${reel.owner || "unknown"}_${(reel.shortCode || reel.id).replace(/[^a-z0-9_-]/gi, "_")}`;

      // ── Download dos bytes ORIGINAIS (zero transformação) ─────────
      const fileBuffer = await downloadOriginalMedia(reel.videoUrl);
      const storagePath = buildLibraryStoragePath(baseName, randomUUID());
      console.log(
        `[save-to-library] original ${(fileBuffer.byteLength / 1_048_576).toFixed(1)} MB → ${storagePath}`
      );

      // ── Upload dos MESMOS bytes para o Supabase Storage ──────────
      const { error: uploadError } = await admin.storage
        .from("videos-library")
        .upload(storagePath, fileBuffer, {
          contentType: "video/mp4",
          upsert: false,
        });

      if (uploadError) throw new Error(`Storage: ${uploadError.message}`);
      uploadedPath = storagePath;

      // ── Get public URL ────────────────────────────────────────
      const { data: urlData } = admin.storage
        .from("videos-library")
        .getPublicUrl(storagePath);

      // ── Insert DB record ──────────────────────────────────────
      const { data, error: dbError } = await admin
        .from("videos_library")
        .insert({
          user_id: user.id,
          folder_id: folderId,
          filename: storagePath.split("/").pop()!,
          original_url: reel.videoUrl,
          storage_path: storagePath,
          public_url: urlData.publicUrl,
          file_size: fileBuffer.byteLength,
          owner_username: reel.owner || null,
          caption: captionParaBanco(reel),
          source_url: reel.sourceUrl ?? null,
          // Colunas inteiras no Postgres. O Apify manda `videoDuration`
          // fracionário (18.266666) e `Number(...)` preservava a fração,
          // fazendo o INSERT inteiro falhar — ver toIntegerColumn.
          views: toIntegerColumn(reel.views),
          likes: toIntegerColumn(reel.likes),
          comments: toIntegerColumn(reel.comments),
          duration: toIntegerColumn(reel.duration),
        } as never)
        .select("id, filename, public_url, owner_username, caption, source_url, created_at")
        .single();

      if (dbError) throw new Error(`DB: ${dbError.message}`);

      savedRecords.push(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[save-to-library] reel ${reel.shortCode || reel.id}:`, msg);
      errors++;
      // URL assinada do CDN morta → renovável numa run de Apify. Storage/DB e
      // demais erros não se resolvem trocando a URL.
      const expired = /HTTP 403|fetch failed|muito pequeno/i.test(msg);
      failures.push({
        id: reel.id,
        shortCode: reel.shortCode,
        reason: expired ? "expired" : "other",
      });

      // COMPENSAÇÃO — mesma regra de app/api/library/record: o upload precede
      // o INSERT (a public_url só existe depois de subir), então uma falha no
      // meio deixaria um arquivo órfão permanente. Em 2026-09-08 foram 124 de
      // uma vez. Removemos APENAS o arquivo desta iteração, e só depois de
      // confirmar que nenhuma linha o referencia — nunca uma limpeza global.
      if (uploadedPath) {
        try {
          const { count } = await admin
            .from("videos_library")
            .select("id", { count: "exact", head: true })
            .eq("storage_path", uploadedPath);

          if (!count) {
            const { error: rollbackError } = await admin.storage
              .from("videos-library")
              .remove([uploadedPath]);
            console.log(
              `[save-to-library] compensação de ${uploadedPath}: ` +
              `${rollbackError ? "falhou (arquivo ficou órfão)" : "arquivo removido"}`
            );
          }
        } catch (cleanupErr) {
          console.error(
            `[save-to-library] compensação de ${uploadedPath} falhou:`,
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr
          );
        }
      }
    }
  }

  return NextResponse.json({
    saved: savedRecords.length,
    errors,
    records: savedRecords,
    failures,
  });
}

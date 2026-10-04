import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { storagePath, filename, fileSize, folderId } = await req.json() as {
    storagePath: string;
    filename: string;
    fileSize: number;
    folderId: string;
  };

  if (!storagePath || !filename) {
    return NextResponse.json(
      { error: "storagePath e filename são obrigatórios." },
      { status: 400 }
    );
  }

  if (!folderId) {
    return NextResponse.json(
      { error: "folderId é obrigatório. Selecione uma pasta antes de fazer upload." },
      { status: 400 }
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({
      success: true,
      record: {
        id: `mock_${Date.now()}`,
        filename,
        public_url: "",
        storage_path: storagePath,
        file_size: fileSize ?? 0,
        owner_username: null,
        caption: null,
        views: 0,
        likes: 0,
        comments: 0,
        duration: 0,
        created_at: new Date().toISOString(),
      },
    });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const userId = user.id;

  const admin = getSupabaseAdmin();

  // SEGURANÇA P1: Valida propriedade do storagePath ANTES de qualquer operação.
  // Um cliente malicioso não pode registrar um arquivo de outro usuário enviando
  // um storagePath arbitrário. O path deve começar com o user_id ou ser um upload
  // direto autorizado (direct/<user_id>/). Isso impede o ataque descrito no prompt:
  // cadastrar caminho alheio → excluir registro próprio → apagar arquivo da vítima.
  const isOwnedPath = storagePath.startsWith(`${userId}/`) || storagePath.startsWith(`direct/${userId}/`);
  if (!isOwnedPath) {
    console.warn(
      `[library-record] Tentativa de registrar storagePath não pertencente ao usuário ${userId}: ${storagePath}. ` +
      `Requisição rejeitada antes do INSERT.`
    );
    return NextResponse.json(
      { error: "storagePath não pertence a este usuário. Upload inválido." },
      { status: 403 }
    );
  }

  // Confirma que a pasta informada pertence ao usuário logado
  const { data: folder } = await admin
    .from("library_folders")
    .select("id")
    .eq("id", folderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!folder) {
    return NextResponse.json({ error: "Pasta não encontrada." }, { status: 404 });
  }

  const { data: urlData } = admin.storage
    .from("videos-library")
    .getPublicUrl(storagePath);

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    filename,
    original_url: null,
    storage_path: storagePath,
    public_url: urlData.publicUrl,
    file_size: fileSize ?? 0,
    owner_username: null,
    caption: null,
    views: 0,
    likes: 0,
    comments: 0,
    duration: 0,
  };
  insertPayload.folder_id = folderId;

  const { data: record, error } = await admin
    .from("videos_library")
    .insert(insertPayload as never)
    .select()
    .single();

  if (error) {
    // Compensação: o arquivo já subiu ao Storage antes desta rota ser chamada.
    // Sem isso, todo INSERT que falha deixa um arquivo órfão permanente.
    //
    // SEGURANÇA: Validamos que o storagePath pertence a este usuário ANTES de
    // qualquer remoção. Um cliente malicioso não pode usar esta rota para apagar
    // arquivos de outros usuários enviando storage_paths alheios.
    // O path deve começar com o user_id ou ser um upload direto autorizado.
    const isOwnedPath = storagePath.startsWith(`${userId}/`) || storagePath.startsWith(`direct/${userId}/`);
    if (!isOwnedPath) {
      console.warn(
        `[library-record] INSERT falhou — storagePath não pertence ao usuário ${userId}: ${storagePath}. ` +
        `Arquivo preservado (possível tentativa de acesso indevido).`
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // P1 CORREÇÃO: Tratamento robusto de erro na consulta de referências.
    // PROBLEMA ANTERIOR: O código ignorava erro da consulta e tratava
    // `count = null` como zero, podendo apagar um arquivo que ainda tinha
    // referências se a consulta falhasse (timeout, permissão, rede).
    //
    // SOLUÇÃO: Distinguir erro de consulta (não apagar) de ausência
    // comprovada (count === 0). Preservar arquivo em caso de dúvida.
    const { count, error: countErr } = await admin
      .from("videos_library")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", storagePath);

    if (countErr) {
      console.error(
        `[library-record] INSERT falhou — erro ao consultar referências para ${storagePath}: ${countErr.message}. ` +
        `Arquivo preservado (não é seguro apagar sem confirmação).`
      );
    } else if ((count ?? 0) === 0 && !storagePath.startsWith("direct/")) {
      const { error: rollbackError } = await admin.storage
        .from("videos-library")
        .remove([storagePath]);
      console.log(
        `[library-record] INSERT falhou — compensação do arquivo recém-enviado: ` +
        `${rollbackError ? "falhou (arquivo ficou órfão)" : "arquivo removido"}`
      );
    } else {
      console.warn(
        `[library-record] INSERT falhou; arquivo referenciado por ${count ?? 0} linha(s) — preservado.`
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, record });
}

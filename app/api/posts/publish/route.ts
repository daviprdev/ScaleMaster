import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const execFileAsync = promisify(execFile);
const PYTHON_CMD = process.env.PYTHON_CMD ?? (process.platform === "win32" ? "python" : "python3");

export interface PostResult {
  account_id: string;
  username: string;
  status: "ok" | "error";
  media_id?: string;
  code?: string;
  error?: string;
}

// POST /api/posts/publish
// Body: { video_id: string, account_ids: string[], caption: string }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    video_id: string;
    account_ids: string[];
    caption?: string;
  };

  const { video_id, account_ids, caption = "" } = body;

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

  const admin = getSupabaseAdmin();

  // Busca a URL pública do vídeo
  const { data: video, error: videoErr } = await admin
    .from("videos_library")
    .select("public_url, filename")
    .eq("id", video_id)
    .single();

  if (videoErr || !video?.public_url) {
    return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
  }

  // Busca contas com sessão salva
  const { data: accounts, error: accsErr } = await admin
    .from("instagram_accounts")
    .select("id, username, access_token")
    .in("id", account_ids)
    .eq("is_active", true);

  if (accsErr || !accounts?.length) {
    return NextResponse.json({ error: "Nenhuma conta ativa encontrada." }, { status: 404 });
  }

  const scriptPath = path.join(process.cwd(), "python_scripts", "instagram_post.py");
  const results: PostResult[] = [];

  // Garante autenticação do usuário antes de postar
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Usuário não autenticado." }, { status: 401 });
  }

  for (const account of accounts) {
    if (!account.access_token) {
      results.push({
        account_id: account.id,
        username: account.username,
        status: "error",
        error: "Sessão não salva. Reconecte a conta no painel.",
      });
      continue;
    }

    // Escreve sessão em arquivo temporário
    const sessionFile = path.join(os.tmpdir(), `ig_post_${crypto.randomUUID()}.json`);

    try {
      fs.writeFileSync(sessionFile, account.access_token);

      const { stdout } = await execFileAsync(PYTHON_CMD, [
        scriptPath,
        account.username,
        video.public_url,
        caption,
        sessionFile,
      ], { timeout: 90_000, maxBuffer: 1024 * 512 });

      const raw = stdout.trim();
      const lines = raw.split("\n");
      const jsonLine = lines.reverse().find(l => l.trim().startsWith("{"));

      if (!jsonLine) throw new Error("Script não retornou JSON.");

      const pyResult = JSON.parse(jsonLine) as {
        status: string;
        media_id?: string;
        code?: string;
        error?: string;
      };

      results.push({
        account_id: account.id,
        username: account.username,
        status: pyResult.status === "ok" ? "ok" : "error",
        media_id: pyResult.media_id,
        code: pyResult.code,
        error: pyResult.error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      results.push({
        account_id: account.id,
        username: account.username,
        status: "error",
        error: msg.includes("ETIMEDOUT") || msg.includes("timeout")
          ? "Timeout: o Instagram demorou demais. Tente novamente."
          : msg,
      });
    } finally {
      try { fs.unlinkSync(sessionFile); } catch { /* noop */ }
    }
  }

  const allOk = results.every(r => r.status === "ok");
  return NextResponse.json({ success: allOk, results });
}

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { hasPythonServer, callPythonServer } from "@/lib/python-server";
import { publishViaMetaAPI } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";

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

interface PyPublishResult {
  status: string;
  media_id?: string;
  code?: string;
}

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

  const { data: video, error: videoErr } = await admin
    .from("videos_library")
    .select("public_url, filename")
    .eq("id", video_id)
    .single();

  if (videoErr || !video?.public_url) {
    return NextResponse.json({ error: "Vídeo não encontrado." }, { status: 404 });
  }

  const { data: accounts, error: accsErr } = await admin
    .from("instagram_accounts")
    .select("id, username, access_token, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id")
    .in("id", account_ids)
    .eq("is_active", true);

  if (accsErr || !accounts?.length) {
    return NextResponse.json({ error: "Nenhuma conta ativa encontrada." }, { status: 404 });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Usuário não autenticado." }, { status: 401 });
  }

  const scriptPath = path.join(process.cwd(), "python_scripts", "instagram_post.py");
  const results: PostResult[] = [];

  for (const account of accounts) {
    // ── Meta Graph API (contas conectadas via OAuth oficial) ──────────────
    if (account.meta_access_token && account.ig_business_account_id) {
      // Auto-renova token se expira em menos de 7 dias
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
        caption
      );
      results.push({
        account_id: account.id,
        username: account.username,
        status: metaResult.status,
        media_id: metaResult.media_id,
        error: metaResult.error,
      });
      continue;
    }

    // ── instagrapi (legado) ───────────────────────────────────────────────
    if (!account.access_token) {
      results.push({
        account_id: account.id,
        username: account.username,
        status: "error",
        error: "Sem credenciais. Reconecte a conta em Contas.",
      });
      continue;
    }

    if (hasPythonServer()) {
      // --- Modo FastAPI ---
      try {
        const pyResult = await callPythonServer<PyPublishResult>("/posts/publish", {
          username: account.username,
          video_url: video.public_url,
          caption,
          session_json: account.access_token,
        });
        results.push({
          account_id: account.id,
          username: account.username,
          status: pyResult.status === "ok" ? "ok" : "error",
          media_id: pyResult.media_id,
          code: pyResult.code,
        });
      } catch (err) {
        results.push({
          account_id: account.id,
          username: account.username,
          status: "error",
          error: err instanceof Error ? err.message : "Erro desconhecido",
        });
      }
    } else {
      // --- Modo child_process (dev local) ---
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

        const pyResult = JSON.parse(jsonLine) as PyPublishResult;
        results.push({
          account_id: account.id,
          username: account.username,
          status: pyResult.status === "ok" ? "ok" : "error",
          media_id: pyResult.media_id,
          code: pyResult.code,
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
  }

  const allOk = results.every(r => r.status === "ok");
  return NextResponse.json({ success: allOk, results });
}

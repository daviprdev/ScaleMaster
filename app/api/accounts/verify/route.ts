import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { hasPythonServer, callPythonServer } from "@/lib/python-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);
const PYTHON_CMD = process.env.PYTHON_CMD ?? (process.platform === "win32" ? "python" : "python3");

interface PythonResult {
  status: "ok" | "error";
  session_json?: string;
  username?: string;
  full_name?: string;
  biography?: string;
  followers?: number;
  following?: number;
  profile_pic_url?: string | null;
  is_private?: boolean;
  error?: string;
}

async function saveToSupabase(result: PythonResult): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return;

  const admin = getSupabaseAdmin();

  const { data: existing } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("username", result.username!)
    .maybeSingle();

  const payload = {
    display_name: result.full_name || null,
    avatar_url: result.profile_pic_url || null,
    access_token: result.session_json || null,
    is_active: true,
  };

  if (existing) {
    await admin.from("instagram_accounts").update(payload).eq("id", existing.id);
  } else {
    await admin.from("instagram_accounts").insert({ user_id: user.id, username: result.username!, ...payload });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    username?: string;
    code?: string;
    challenge_type?: string;
    session_token?: string;
    two_factor_identifier?: string;
  };

  const { username, code, challenge_type, session_token, two_factor_identifier } = body;

  if (!username?.trim() || !code?.trim() || !session_token?.trim() || !challenge_type?.trim()) {
    return NextResponse.json(
      { error: "Campos obrigatórios: username, code, challenge_type, session_token." },
      { status: 400 }
    );
  }

  let result: PythonResult;

  if (hasPythonServer()) {
    // --- Modo FastAPI ---
    try {
      result = await callPythonServer<PythonResult>("/auth/verify", {
        username: username.trim(),
        code: code.replace(/\s/g, ""),
        challenge_type: challenge_type.trim(),
        session_token: session_token.trim(),
        two_factor_identifier: two_factor_identifier ?? "",
      });
    } catch (err) {
      const e = err as Error & { status?: number };
      const isNetworkError = !e.status && (e.message.includes("fetch failed") || e.message.includes("ECONNREFUSED") || e.message.includes("ENOTFOUND"));
      const msg = isNetworkError
        ? `Servidor Python inacessível (${process.env.PYTHON_SERVER_URL}). Verifique se ele está em execução.`
        : e.message;
      const httpStatus = e.status === 401 ? 401 : e.status === 400 ? 400 : 500;
      return NextResponse.json({ error: msg }, { status: httpStatus });
    }
  } else {
    // --- Modo child_process (dev local) ---
    const scriptPath = path.join(process.cwd(), "python_scripts", "instagram_verify_code.py");
    const args = [
      scriptPath,
      username.trim(),
      code.replace(/\s/g, ""),
      challenge_type.trim(),
      session_token.trim(),
      two_factor_identifier ?? "",
    ];

    try {
      const { stdout } = await execFileAsync(PYTHON_CMD, args, {
        timeout: 55_000,
        maxBuffer: 1024 * 512,
      });

      const raw = stdout.trim();
      if (!raw) throw new Error("O script Python não retornou dados.");

      const lines = raw.split("\n");
      const jsonLine = lines.reverse().find(l => l.trim().startsWith("{"));
      if (!jsonLine) throw new Error("Resposta do script Python não contém JSON válido.");

      result = JSON.parse(jsonLine) as PythonResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao executar o script Python.";
      if (msg.includes("ENOENT")) {
        return NextResponse.json({ error: `Comando '${PYTHON_CMD}' não encontrado.` }, { status: 500 });
      }
      if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
        return NextResponse.json({ error: "Timeout ao verificar código. Tente novamente." }, { status: 408 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (result.status === "error") {
    return NextResponse.json({ error: result.error ?? "Verificação falhou." }, { status: 401 });
  }

  // status === "ok" — persiste no Supabase
  try {
    await saveToSupabase(result);
  } catch (dbErr) {
    console.error("[accounts/verify] DB error:", dbErr);
    return NextResponse.json({
      success: true,
      account: result,
      warning: "Conta conectada mas houve erro ao salvar no banco.",
    });
  }

  return NextResponse.json({ success: true, account: result });
}

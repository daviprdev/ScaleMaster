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

type ChallengeType = "2fa" | "checkpoint";
type VerificationMethod = "authenticator" | "sms" | "email";

interface PythonResult {
  status: "ok" | "requires_code" | "error";
  challenge_type?: ChallengeType;
  verification_method?: VerificationMethod;
  session_token?: string;
  two_factor_identifier?: string;
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

async function runScript(args: string[]): Promise<PythonResult> {
  const { stdout } = await execFileAsync(PYTHON_CMD, args, {
    timeout: 55_000,
    maxBuffer: 1024 * 512,
  });

  const raw = stdout.trim();
  if (!raw) throw new Error("O script Python não retornou dados.");

  const lines = raw.split("\n");
  const jsonLine = lines.reverse().find(l => l.trim().startsWith("{"));
  if (!jsonLine) throw new Error("Resposta do script Python não contém JSON válido.");

  return JSON.parse(jsonLine) as PythonResult;
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
  const body = await req.json() as { username?: string; password?: string };
  const { username, password } = body;

  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Usuário e senha são obrigatórios." }, { status: 400 });
  }

  const cleanUsername = username.replace(/^@/, "").trim();
  let result: PythonResult;

  if (hasPythonServer()) {
    // --- Modo FastAPI ---
    try {
      result = await callPythonServer<PythonResult>("/auth/login", {
        username: cleanUsername,
        password,
      });
    } catch (err) {
      const e = err as Error & { status?: number };
      const httpStatus = e.status === 401 ? 401 : e.status === 429 ? 429 : 500;
      return NextResponse.json({ error: e.message }, { status: httpStatus });
    }
  } else {
    // --- Modo child_process (dev local sem servidor Python) ---
    const scriptPath = path.join(process.cwd(), "python_scripts", "instagram_login.py");
    try {
      result = await runScript([scriptPath, cleanUsername, password]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao executar o script Python.";
      if (msg.includes("ENOENT")) {
        return NextResponse.json(
          { error: `Comando '${PYTHON_CMD}' não encontrado. Verifique se o Python está instalado e no PATH.` },
          { status: 500 }
        );
      }
      if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
        return NextResponse.json(
          { error: "Timeout: o Instagram demorou demais para responder. Tente novamente." },
          { status: 408 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (result.status === "requires_code") {
    return NextResponse.json({
      requires_code: true,
      challenge_type: result.challenge_type,
      verification_method: result.verification_method,
      session_token: result.session_token,
      two_factor_identifier: result.two_factor_identifier ?? "",
      username: result.username ?? cleanUsername,
    });
  }

  if (result.status === "error") {
    return NextResponse.json({ error: result.error ?? "Login falhou." }, { status: 401 });
  }

  // status === "ok" — persiste no Supabase
  try {
    await saveToSupabase(result);
  } catch (dbErr) {
    console.error("[accounts/login] DB error:", dbErr);
    return NextResponse.json({
      success: true,
      account: result,
      warning: "Conta conectada mas houve erro ao salvar no banco.",
    });
  }

  return NextResponse.json({ success: true, account: result });
}

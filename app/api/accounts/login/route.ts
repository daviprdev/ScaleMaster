import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

// Permite override via env var — útil se Python estiver em caminho não-padrão
const PYTHON_CMD = process.env.PYTHON_CMD ?? (process.platform === "win32" ? "python" : "python3");

interface PythonResult {
  success: boolean;
  username?: string;
  full_name?: string;
  biography?: string;
  followers?: number;
  following?: number;
  profile_pic_url?: string | null;
  is_private?: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { username?: string; password?: string };
  const { username, password } = body;

  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: "Usuário e senha são obrigatórios." },
      { status: 400 }
    );
  }

  const cleanUsername = username.replace(/^@/, "").trim();
  const scriptPath = path.join(process.cwd(), "python_scripts", "instagram_login.py");

  let result: PythonResult;

  try {
    const { stdout } = await execFileAsync(
      PYTHON_CMD,
      [scriptPath, cleanUsername, password],
      {
        timeout: 55_000,
        maxBuffer: 1024 * 512, // 512 KB — mais que suficiente para o JSON de resposta
      }
    );

    const raw = stdout.trim();
    if (!raw) throw new Error("O script Python não retornou dados.");

    // Pega apenas a última linha com JSON válido (ignora qualquer log anterior)
    const lines = raw.split("\n");
    const jsonLine = lines.reverse().find(l => l.trim().startsWith("{"));
    if (!jsonLine) throw new Error("Resposta do script Python não contém JSON válido.");

    result = JSON.parse(jsonLine) as PythonResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao executar o script Python.";

    if (msg.includes("ENOENT")) {
      return NextResponse.json(
        { error: `Comando '${PYTHON_CMD}' não encontrado. Verifique se o Python está instalado e no PATH, ou defina a variável PYTHON_CMD no .env.local.` },
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

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Login falhou." }, { status: 401 });
  }

  // ── Salva no Supabase ──────────────────────────────────────
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const supabaseUser = await createClient();
      const { data: { user } } = await supabaseUser.auth.getUser();

      if (user) {
        const admin = getSupabaseAdmin();

        // Verifica se a conta já existe para esse usuário
        const { data: existing } = await admin
          .from("instagram_accounts")
          .select("id")
          .eq("user_id", user.id)
          .eq("username", result.username!)
          .maybeSingle();

        if (existing) {
          await admin
            .from("instagram_accounts")
            .update({
              display_name: result.full_name || null,
              avatar_url: result.profile_pic_url || null,
              is_active: true,
            })
            .eq("id", existing.id);
        } else {
          await admin
            .from("instagram_accounts")
            .insert({
              user_id: user.id,
              username: result.username!,
              display_name: result.full_name || null,
              avatar_url: result.profile_pic_url || null,
              is_active: true,
            });
        }
      }
    } catch (dbErr) {
      // Não falha o request por erro de DB — retorna sucesso com aviso
      console.error("[accounts/login] DB error:", dbErr);
      return NextResponse.json({
        success: true,
        account: result,
        warning: "Conta conectada mas houve erro ao salvar no banco.",
      });
    }
  }

  return NextResponse.json({ success: true, account: result });
}

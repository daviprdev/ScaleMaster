import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

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
  const body = await req.json() as {
    username?: string;
    code?: string;
    two_factor_identifier?: string;
    session_token?: string;
  };

  const { username, code, two_factor_identifier, session_token } = body;

  if (!username?.trim() || !code?.trim() || !session_token?.trim()) {
    return NextResponse.json(
      { error: "Campos obrigatórios: username, code, session_token." },
      { status: 400 }
    );
  }

  const scriptPath = path.join(process.cwd(), "python_scripts", "instagram_verify2fa.py");

  let result: PythonResult;

  try {
    const { stdout } = await execFileAsync(
      PYTHON_CMD,
      [
        scriptPath,
        username.trim(),
        code.replace(/\s/g, ""),
        two_factor_identifier ?? "",
        session_token.trim(),
      ],
      { timeout: 55_000, maxBuffer: 1024 * 512 }
    );

    const raw = stdout.trim();
    if (!raw) throw new Error("O script Python não retornou dados.");

    const lines = raw.split("\n");
    const jsonLine = lines.reverse().find(l => l.trim().startsWith("{"));
    if (!jsonLine) throw new Error("Resposta do script Python não contém JSON válido.");

    result = JSON.parse(jsonLine) as PythonResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao executar o script Python.";

    if (msg.includes("ENOENT")) {
      return NextResponse.json(
        { error: `Comando '${PYTHON_CMD}' não encontrado.` },
        { status: 500 }
      );
    }
    if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
      return NextResponse.json(
        { error: "Timeout ao verificar 2FA. Tente novamente." },
        { status: 408 }
      );
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Verificação 2FA falhou." }, { status: 401 });
  }

  // ── Salva no Supabase ──────────────────────────────────────
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const supabaseUser = await createClient();
      const { data: { user } } = await supabaseUser.auth.getUser();

      if (user) {
        const admin = getSupabaseAdmin();

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
      console.error("[accounts/verify2fa] DB error:", dbErr);
      return NextResponse.json({
        success: true,
        account: result,
        warning: "Conta conectada mas houve erro ao salvar no banco.",
      });
    }
  }

  return NextResponse.json({ success: true, account: result });
}

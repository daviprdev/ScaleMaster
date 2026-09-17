/**
 * POST /api/onboarding/jobs/[id]/browser-test
 *
 * Teste manual do motor "browser" (Playwright) com as credenciais JÁ
 * cadastradas num job de onboarding — sem o usuário redigitar senha/proxy e
 * sem expor PYTHON_SERVER_SECRET ao browser.
 *
 * Não mexe no job: não muda status, etapa, retry nem error_message. Só chama
 * /test-browser-login no python_server, que salva a sessão em
 * ig_browser_sessions quando o login dá certo. O motor instagrapi e o cron
 * process-onboarding-jobs seguem exatamente como estão.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptMaybe } from "@/lib/encrypt";
import { callPythonServer, hasPythonServer } from "@/lib/python-server";
import { isUuid } from "@/lib/managed-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase nao configurado" }, { status: 503 });
  }
  if (!hasPythonServer()) {
    return NextResponse.json({ error: "PYTHON_SERVER_URL nao configurado" }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "id invalido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  let body: { headless?: boolean; use_saved_session?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // corpo opcional
  }

  const { data: job, error } = await supabase
    .from("onboarding_jobs")
    .select("id, username, password_enc, two_factor_enc, proxy_url_enc, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job nao encontrado." }, { status: 404 });
  if (job.status === "processing") {
    // Dois logins simultaneos na mesma conta sao sinal de bot.
    return NextResponse.json({ error: "Job em execucao pelo motor atual. Tente em alguns minutos." }, { status: 409 });
  }

  const password = decryptMaybe(job.password_enc);
  const proxy = decryptMaybe(job.proxy_url_enc);
  if (!password) return NextResponse.json({ error: "Job sem senha." }, { status: 422 });
  if (!proxy) return NextResponse.json({ error: "Job sem proxy — o motor browser nao roda sem proxy fixa." }, { status: 422 });

  try {
    const result = await callPythonServer<Record<string, unknown>>(
      "/test-browser-login",
      {
        username: job.username,
        password,
        proxy,
        totp_secret: decryptMaybe(job.two_factor_enc),
        user_id: user.id,
        use_saved_session: body.use_saved_session !== false,
        save_session: true,
        headless: typeof body.headless === "boolean" ? body.headless : null,
        include_screenshot: true,
      },
      140_000
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao chamar o python_server" },
      { status: 502 }
    );
  }
}

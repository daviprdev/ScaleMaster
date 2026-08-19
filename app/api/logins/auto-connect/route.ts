import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { claimProxyForAccount } from "@/lib/proxy-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stagger inicial entre contas do mesmo lote — fase de calibração conservadora
// (mesmo princípio de process-loops: espalha ao longo do dia em vez de logar
// tudo de uma vez). Ajustável sem mexer no resto do fluxo.
const STAGGER_MINUTES = 45;
const JITTER_RATIO = 0.3;

// POST — dispara a conexão automática (login via instagrapi) para 1+ entradas
// do Logins Vault. Cria uma conta provisória em instagram_accounts, reserva
// um proxy dedicado e enfileira o job de login — o cron processa a partir daí.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null) as { login_ids?: string[] } | null;
  const loginIds = body?.login_ids;
  if (!Array.isArray(loginIds) || loginIds.length === 0) {
    return NextResponse.json({ error: "login_ids obrigatório" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // RLS garante que só vêm entradas do próprio usuário.
  const { data: logins, error: loginsErr } = await supabase
    .from("account_logins")
    .select("id, username")
    .in("id", loginIds);

  if (loginsErr) return NextResponse.json({ error: loginsErr.message }, { status: 500 });
  if (!logins?.length) {
    return NextResponse.json({ error: "Nenhuma credencial encontrada para os ids informados" }, { status: 404 });
  }

  const results: Array<{ login_id: string; username: string; ok: boolean; reason?: string }> = [];

  for (let i = 0; i < logins.length; i++) {
    const login = logins[i];
    try {
      // Conta provisória — sem constraint única em (user_id, username) nesta
      // tabela, então segue o mesmo padrão de select-então-insert/update do
      // callback OAuth em vez de upsert com onConflict.
      const { data: existing } = await admin
        .from("instagram_accounts")
        .select("id")
        .eq("user_id", user.id)
        .eq("username", login.username)
        .maybeSingle();

      let accountId: string | undefined = existing?.id;
      if (accountId) {
        const { error: updErr } = await admin
          .from("instagram_accounts")
          .update({ connection_method: "instagrapi", health_status: "online" })
          .eq("id", accountId);
        if (updErr) {
          results.push({ login_id: login.id, username: login.username, ok: false, reason: updErr.message });
          continue;
        }
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("instagram_accounts")
          .insert({
            user_id: user.id,
            username: login.username,
            connection_method: "instagrapi",
            is_active: false,
            health_status: "online",
            connected_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          results.push({ login_id: login.id, username: login.username, ok: false, reason: insErr?.message ?? "falha ao criar conta" });
          continue;
        }
        accountId = inserted.id;
      }

      const account = { id: accountId as string };

      // Falha ao reservar proxy não bloqueia — só fica sem proxy dedicado, e o
      // cron não tenta logar sem proxy (regra do projeto: sem proxy, sem chamada
      // em nome da conta).
      await claimProxyForAccount(admin, user.id, account.id).catch((e) => {
        console.warn(`[auto-connect] Falha ao reservar proxy para ${login.username}: ${String(e)}`);
      });

      const jitterMin = STAGGER_MINUTES * JITTER_RATIO * (Math.random() * 2 - 1);
      const retryAfter = new Date(Date.now() + Math.max(0, i * STAGGER_MINUTES + jitterMin) * 60_000);

      const { error: jobErr } = await admin.from("login_jobs").insert({
        user_id: user.id,
        account_id: account.id,
        account_login_id: login.id,
        status: "queued",
        retry_after: retryAfter.toISOString(),
      });

      if (jobErr) {
        results.push({ login_id: login.id, username: login.username, ok: false, reason: jobErr.message });
        continue;
      }

      results.push({ login_id: login.id, username: login.username, ok: true });
    } catch (e) {
      results.push({ login_id: login.id, username: login.username, ok: false, reason: String(e) });
    }
  }

  return NextResponse.json({ results });
}

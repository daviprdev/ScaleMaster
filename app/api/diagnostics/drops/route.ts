import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Categorização de erros por padrão de texto
// ---------------------------------------------------------------------------

type ErrorCategory =
  | "token"       // Token inválido, expirado, OAuthException
  | "blocked"     // Conta bloqueada, checkpoint
  | "rate_limit"  // Too many actions, rate limit
  | "personal"    // Conta pessoal sem suporte à API de Reels
  | "transient"   // Erro transitório (unexpected error, service unavailable)
  | "unknown";

interface CategoryInfo {
  category: ErrorCategory;
  label: string;
  color: string;
}

function categorize(reason: string | null): CategoryInfo {
  const r = (reason ?? "").toLowerCase();
  if (
    r.includes("oauthexception") ||
    r.includes("invalid_token") ||
    r.includes("access token") ||
    r.includes("token has expired") ||
    r.includes("session has been invalidated") ||
    r.includes("sessions for the user are not allowed") ||
    r.includes("error_code\":190") ||
    r.includes("error code 190") ||
    r.includes("not a confirmed user")
  ) {
    return { category: "token", label: "Token Inválido/Expirado", color: "red" };
  }
  if (
    r.includes("blocked") ||
    r.includes("checkpoint") ||
    r.includes("restricted") ||
    r.includes("error_code\":200") ||
    r.includes("error code 200")
  ) {
    return { category: "blocked", label: "Conta Bloqueada/Restrita", color: "orange" };
  }
  if (
    r.includes("too many actions") ||
    r.includes("rate limit") ||
    r.includes("performing too many") ||
    r.includes("spam")
  ) {
    return { category: "rate_limit", label: "Rate Limit Meta", color: "amber" };
  }
  if (
    r.includes("unsupported request") ||
    r.includes("method type: post")
  ) {
    return { category: "personal", label: "Conta Pessoal (sem API)", color: "blue" };
  }
  if (
    r.includes("unexpected error") ||
    r.includes("service unavailable") ||
    r.includes("please retry") ||
    r.includes("retry your request") ||
    r.includes("internal server error")
  ) {
    return { category: "transient", label: "Erro Transitório", color: "blue" };
  }
  return { category: "unknown", label: "Erro Desconhecido", color: "gray" };
}

// ---------------------------------------------------------------------------
// GET /api/diagnostics/drops
// ---------------------------------------------------------------------------

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const since48h = new Date(now.getTime() - 48 * 60 * 60_000).toISOString();
  const since7d  = new Date(now.getTime() -  7 * 24 * 60 * 60_000).toISOString();

  // Busca paralela
  const [failoverRes, containersRes, accountsRes] = await Promise.all([
    // 30 dias para cobrir contas que caíram antes da janela de 7d
    admin
      .from("failover_logs")
      .select("id, error_reason, created_at, failed_account_id, failed_account:failed_account_id(username)")
      .eq("user_id", user.id)
      .gte("created_at", since30d)
      .order("created_at", { ascending: false })
      .limit(1000),

    // pending_containers com erros reais (exclui mensagens de sistema do AUTO-HEALING)
    // Sem filtro de data — queremos o erro mais recente independente de quando ocorreu
    admin
      .from("pending_containers")
      .select("id, error_message, created_at, account_id, instagram_accounts:account_id(username)")
      .eq("user_id", user.id)
      .eq("status", "error")
      .not("error_message", "is", null)
      .not("error_message", "like", "[AUTO-HEALING]%")
      .order("created_at", { ascending: false })
      .limit(1000),

    admin
      .from("instagram_accounts")
      .select("id, username, health_status, token_expires_at, meta_access_token")
      .eq("user_id", user.id)
      .eq("is_active", true),
  ]);

  const failoverLogs = (failoverRes.data ?? []) as {
    id: string;
    error_reason: string | null;
    created_at: string;
    failed_account_id: string;
    failed_account: { username: string } | null;
  }[];

  const errorContainers = (containersRes.data ?? []) as {
    id: string;
    error_message: string | null;
    created_at: string;
    account_id: string;
    instagram_accounts: { username: string } | null;
  }[];

  const allAccounts = (accountsRes.data ?? []) as {
    id: string;
    username: string;
    health_status: string;
    token_expires_at: string | null;
    meta_access_token: string | null;
  }[];

  // ── Categorização de failover_logs ────────────────────────────────────────
  const catCounts: Record<ErrorCategory, number> = {
    token: 0, blocked: 0, rate_limit: 0, personal: 0, transient: 0, unknown: 0,
  };
  for (const log of failoverLogs) {
    catCounts[categorize(log.error_reason).category]++;
  }

  const totalLogs = failoverLogs.length;
  const categories = (Object.entries(catCounts) as [ErrorCategory, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({
      ...categorize(cat === "token" ? "oauthexception" :
                    cat === "blocked" ? "blocked" :
                    cat === "rate_limit" ? "too many actions" :
                    cat === "personal" ? "unsupported request" :
                    cat === "transient" ? "unexpected error" : ""),
      category: cat,
      count,
      percentage: totalLogs > 0 ? Math.round((count / totalLogs) * 100) : 0,
    }));

  // ── Timeline: quedas por hora (últimas 48h) ───────────────────────────────
  const buckets: Record<string, number> = {};
  const recentLogs = failoverLogs.filter(l => l.created_at >= since48h);
  for (const log of recentLogs) {
    const hourKey = log.created_at.slice(0, 13); // "2026-06-05T14"
    buckets[hourKey] = (buckets[hourKey] ?? 0) + 1;
  }
  // Constrói array das últimas 48h, preenchendo zeros
  const timeline: { hour: string; label: string; count: number }[] = [];
  for (let i = 47; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 60 * 60_000);
    const key = h.toISOString().slice(0, 13);
    const label = `${String(h.getUTCHours()).padStart(2, "0")}h`;
    timeline.push({ hour: key, label, count: buckets[key] ?? 0 });
  }

  // ── Pico de quedas simultâneas (thundering herd indicator) ────────────────
  const maxInOneHour = Math.max(...Object.values(buckets), 0);
  const thunderingHerd = maxInOneHour >= 4; // 4+ quedas na mesma hora = provável problema de App ID

  // ── Contas em erro com último motivo ─────────────────────────────────────
  const errorAccounts: {
    id: string;
    username: string;
    category: string;
    categoryLabel: string;
    categoryColor: string;
    lastError: string | null;
    lastDropAt: string | null;
    tokenExpiresAt: string | null;
    hasToken: boolean;
  }[] = [];

  // Constante para detectar mensagens de sistema que não representam o erro real
  const isSystemMessage = (msg: string | null) =>
    !msg ||
    msg.startsWith("[AUTO-HEALING]") ||
    msg.startsWith("[loop-cron]") ||
    msg.trim() === "";

  const errorAccountsList = allAccounts.filter(a => a.health_status === "error");
  for (const acc of errorAccountsList) {
    // 1. Prioridade: failover_logs (tem o erro do momento da queda)
    const lastLog = failoverLogs.find(
      l => l.failed_account_id === acc.id && !isSystemMessage(l.error_reason)
    );

    // 2. Fallback: pending_containers com erro real (já filtrado de AUTO-HEALING na query)
    const lastContainer = errorContainers.find(c => c.account_id === acc.id);

    // 3. Último recurso: qualquer failover_log desta conta (mesmo sem mensagem)
    const anyLog = failoverLogs.find(l => l.failed_account_id === acc.id);

    const lastError = lastLog?.error_reason ?? lastContainer?.error_message ?? null;
    const lastDropAt = lastLog?.created_at ?? lastContainer?.created_at ?? anyLog?.created_at ?? null;

    const { category, label, color } = categorize(lastError);
    errorAccounts.push({
      id: acc.id,
      username: acc.username,
      category,
      categoryLabel: label,
      categoryColor: color,
      lastError: lastError ? lastError.slice(0, 300) : null,
      lastDropAt,
      tokenExpiresAt: acc.token_expires_at,
      hasToken: !!acc.meta_access_token,
    });
  }

  // ── Token health de contas online ────────────────────────────────────────
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString();
  const expiringTokens = allAccounts
    .filter(a =>
      a.health_status !== "error" &&
      a.meta_access_token &&
      a.token_expires_at &&
      a.token_expires_at <= sevenDaysFromNow
    )
    .map(a => ({
      id: a.id,
      username: a.username,
      token_expires_at: a.token_expires_at!,
      days_left: Math.max(0, Math.floor((new Date(a.token_expires_at!).getTime() - now.getTime()) / 86_400_000)),
    }))
    .sort((a, b) => a.days_left - b.days_left);

  // ── Erros mais frequentes (top 5) ────────────────────────────────────────
  const errorMsgMap: Record<string, { count: number; accounts: Set<string> }> = {};
  for (const log of failoverLogs) {
    const key = (log.error_reason ?? "Erro desconhecido").slice(0, 100);
    if (!errorMsgMap[key]) errorMsgMap[key] = { count: 0, accounts: new Set() };
    errorMsgMap[key].count++;
    if (log.failed_account?.username) errorMsgMap[key].accounts.add(log.failed_account.username);
  }
  const topErrors = Object.entries(errorMsgMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([message, { count, accounts }]) => ({
      message,
      count,
      accounts: [...accounts].slice(0, 5),
      category: categorize(message),
    }));

  const drops7d = failoverLogs.filter(l => l.created_at >= since7d).length;

  return NextResponse.json({
    summary: {
      total_drops_7d: drops7d,
      accounts_in_error: errorAccountsList.length,
      accounts_online: allAccounts.filter(a => a.health_status === "online").length,
      tokens_expiring_soon: expiringTokens.length,
      thundering_herd: thunderingHerd,
      max_drops_in_one_hour: maxInOneHour,
    },
    categories,
    timeline,
    error_accounts: errorAccounts,
    expiring_tokens: expiringTokens,
    top_errors: topErrors,
  });
}

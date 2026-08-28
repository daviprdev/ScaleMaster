import { NextRequest, NextResponse } from "next/server";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt } from "@/lib/encrypt";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/debug/proxy-pool-check — checagem pontual (não usada pelo app) do
// estoque LIVRE de proxy_pool: pra cada entrada sem conta atribuída, sai pela
// rede via esse proxy e consulta ipinfo.io/json (retorna ip + org do IP de saída).
// Serve pra confirmar residencial/ISP de verdade vs. datacenter disfarçado
// ANTES de atribuir às contas. Protegido por CRON_SECRET (não por sessão Supabase)
// porque é uma checagem ad-hoc, não uma feature do produto.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[proxy-pool-check] CRON_SECRET não configurado — rota aberta.");
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 50), 100);

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from("proxy_pool")
    .select("id, proxy_url, created_at")
    .is("assigned_account_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ results: [], total: 0 });

  const HOSTING_HINTS = [
    "hosting", "cloud", "data center", "datacenter", "server", "vps",
    "digitalocean", "ovh", "aws", "amazon", "google", "azure", "hetzner",
    "latitude", "vultr", "linode", "leaseweb", "contabo",
  ];

  const BATCH_SIZE = 8;
  const results: Array<{
    id: string;
    host: string;
    ip: string | null;
    org: string | null;
    city: string | null;
    region: string | null;
    likely_datacenter: boolean | null;
    error: string | null;
  }> = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (row: { id: string; proxy_url: string; created_at: string }) => {
        let host = "?";
        try {
          const raw = decrypt(row.proxy_url);
          const u = new URL(raw);
          host = `${u.hostname}:${u.port || "?"}`;
          const agent = new ProxyAgent(raw);
          const res = await undiciFetch("https://ipinfo.io/json", {
            dispatcher: agent,
            signal: AbortSignal.timeout(12_000),
          } as any);
          const data = (await res.json()) as {
            ip?: string; org?: string; city?: string; region?: string;
          };
          const orgLower = (data.org ?? "").toLowerCase();
          const likelyDatacenter = HOSTING_HINTS.some((h) => orgLower.includes(h));
          return {
            id: row.id, host,
            ip: data.ip ?? null, org: data.org ?? null,
            city: data.city ?? null, region: data.region ?? null,
            likely_datacenter: data.org ? likelyDatacenter : null,
            error: null,
          };
        } catch (e) {
          return {
            id: row.id, host,
            ip: null, org: null, city: null, region: null,
            likely_datacenter: null,
            error: e instanceof Error ? e.message.slice(0, 100) : "erro",
          };
        }
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }

  const withOrg = results.filter((r) => r.org);
  const datacenterCount = withOrg.filter((r) => r.likely_datacenter).length;

  return NextResponse.json({
    total: results.length,
    checked_ok: withOrg.length,
    likely_datacenter: datacenterCount,
    likely_residential_or_unknown: withOrg.length - datacenterCount,
    results,
  });
}

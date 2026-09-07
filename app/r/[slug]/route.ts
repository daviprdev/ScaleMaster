import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  isWellFormedSlug,
  buildRedirectUrl,
  validateDestinationUrl,
  deviceTypeFromUserAgent,
  browserFamilyFromUserAgent,
  referrerHost,
} from "@/lib/managed-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /r/{slug} — o redirecionador público.
 *
 * SEM CLOAKING: o destino sai de `managed_links.destination_url` e de mais
 * lugar nenhum. Não existe ramificação por User-Agent, por referrer, por país
 * nem por "parece um crawler" — todo visitante do mesmo slug vai para a mesma
 * URL. O User-Agent só é lido para virar uma categoria de analytics, e essa
 * categoria nunca volta para o cálculo do destino.
 *
 * SEM OPEN REDIRECT: a rota não aceita `?url=`. O único dado de entrada que
 * escolhe destino é o slug, e o destino vem persistido do banco.
 *
 * CAMINHO CRÍTICO (Story → link → destino): UMA ida ao banco resolve tudo.
 * A RPC `resolve_managed_link` faz lookup + incremento atômico + insert de
 * clique em uma transação curta, com o analytics isolado num bloco EXCEPTION
 * — se o registro do clique falhar, o redirect acontece do mesmo jeito.
 *
 * Por que não `void insert(...)` depois da resposta: em serverless a função é
 * congelada assim que a resposta sai e a promise solta morre — cliques seriam
 * perdidos em silêncio. E por que não `waitUntil`: exigiria uma dependência
 * nova (@vercel/functions) para ganhar menos do que o round-trip único já
 * entrega. O usuário pediu confiabilidade primeiro.
 *
 * O middleware não cobre `/r/*` (matcher em middleware.ts), então nenhuma
 * sessão do Supabase é carregada aqui: o visitante não é autenticado e não
 * precisa ser.
 */

/** 302, nunca 301: o destino muda e um 301 fica cacheado no browser para sempre. */
const REDIRECT_STATUS = 302;

const BASE_HEADERS: Record<string, string> = {
  // O destino pode mudar a qualquer momento — nada de CDN ou browser segurando
  // o destino antigo.
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  // Links de redirect não devem ser indexados.
  "X-Robots-Tag": "noindex, nofollow",
};

function htmlResponse(status: number, titulo: string, mensagem: string) {
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${titulo}</title>
<style>
  html,body{margin:0;height:100%;background:#000;color:#e5e5e5;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:380px;text-align:center;background:rgba(255,255,255,.03);
    border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:36px 28px}
  h1{font-size:17px;margin:0 0 10px;font-weight:600}
  p{font-size:13px;line-height:1.6;color:rgba(255,255,255,.45);margin:0}
  .dot{width:8px;height:8px;border-radius:50%;background:#00FF41;
    box-shadow:0 0 12px rgba(0,255,65,.8);margin:0 auto 18px}
</style></head>
<body><div class="wrap"><div class="card">
<div class="dot"></div><h1>${titulo}</h1><p>${mensagem}</p>
</div></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

interface ResolveRow {
  out_link_id: string;
  out_destination: string;
  out_status: "active" | "paused" | "archived";
  out_forward: boolean;
  out_click_logged: boolean;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const t0 = Date.now();
  const { slug } = await params;

  // Slug malformado nem chega ao banco.
  if (!isWellFormedSlug(slug)) {
    return htmlResponse(404, "Link não encontrado", "Confira o endereço e tente novamente.");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[managed-link] redirect sem configuração de banco");
    return htmlResponse(503, "Serviço indisponível", "Tente novamente em alguns instantes.");
  }

  const url = new URL(req.url);
  const q = url.searchParams;

  // Redução de dado pessoal ANTES de tocar no banco: o IP nunca é lido, o
  // User-Agent vira categoria e do Referer sobra só o hostname.
  const device = deviceTypeFromUserAgent(req.headers.get("user-agent"));
  const browser = browserFamilyFromUserAgent(req.headers.get("user-agent"));
  const refHost = referrerHost(req.headers.get("referer"));
  // País vem pronto do edge da Vercel (só o código ISO de 2 letras).
  const country = req.headers.get("x-vercel-ip-country");

  let row: ResolveRow | null = null;
  try {
    const { data, error } = await getSupabaseAdmin().rpc("resolve_managed_link", {
      p_slug: slug,
      p_referrer_host: refHost,
      p_device_type: device,
      p_browser_family: browser,
      p_country: country,
      p_utm_source: q.get("utm_source"),
      p_utm_medium: q.get("utm_medium"),
      p_utm_campaign: q.get("utm_campaign"),
    });
    if (error) throw new Error(error.message);
    row = (Array.isArray(data) ? data[0] : data) as ResolveRow | undefined ?? null;
  } catch (err) {
    console.error(`[managed-link] error slug=${slug} elapsed_ms=${Date.now() - t0}`,
      err instanceof Error ? err.message : err);
    return htmlResponse(503, "Serviço indisponível", "Não foi possível resolver este link agora. Tente novamente em instantes.");
  }

  if (!row) {
    console.log(`[managed-link] redirect slug=${slug} status=404 elapsed_ms=${Date.now() - t0}`);
    return htmlResponse(404, "Link não encontrado", "Este link não existe ou foi removido.");
  }

  // Arquivado é a exclusão suave: some para o público como se não existisse,
  // mas o histórico e o analytics ficam preservados no painel.
  if (row.out_status === "archived") {
    console.log(`[managed-link] redirect link=${row.out_link_id.slice(0, 8)} status=archived elapsed_ms=${Date.now() - t0}`);
    return htmlResponse(404, "Link não encontrado", "Este link não existe ou foi removido.");
  }

  // Pausado: 410 Gone. O destino NUNCA é revelado aqui.
  if (row.out_status === "paused") {
    console.log(`[managed-link] redirect link=${row.out_link_id.slice(0, 8)} status=paused elapsed_ms=${Date.now() - t0}`);
    return htmlResponse(410, "Link temporariamente indisponível", "Este link está pausado no momento. Tente novamente mais tarde.");
  }

  // Revalida o destino na saída. Se algo gravou lixo na coluna (ou uma
  // constraint futura for afrouxada), é melhor devolver erro do que emitir um
  // Location inválido ou perigoso.
  const check = validateDestinationUrl(row.out_destination);
  if (!check.ok) {
    console.error(`[managed-link] destino inválido link=${row.out_link_id.slice(0, 8)} motivo=${check.error}`);
    return htmlResponse(410, "Link indisponível", "Este link está com uma configuração inválida. Avise quem o divulgou.");
  }

  const finalUrl = buildRedirectUrl(check.url, q, row.out_forward);

  console.log(
    `[managed-link] redirect link=${row.out_link_id.slice(0, 8)} slug=${slug} status=302 ` +
    `forward=${row.out_forward} click_logged=${row.out_click_logged} elapsed_ms=${Date.now() - t0}`
  );

  return NextResponse.redirect(finalUrl, {
    status: REDIRECT_STATUS,
    headers: BASE_HEADERS,
  });
}

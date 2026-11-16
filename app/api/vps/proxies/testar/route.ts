import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LOTE_MAX, parseProxies } from "@/lib/vps/input";
import { entraNoLote, testarProxies } from "@/lib/vps/testar-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 25 s por tentativa, mais 2 com 5 s: uma proxy morta leva ~85 s (o nginx espera 300 s).
export const maxDuration = 120;

/** Teto de linhas por teste (o lote usa até LOTE_MAX e as excedentes cobrem as mortas). */
const MAX_LINHAS = LOTE_MAX * 2;

// POST { proxies } — "Testar proxies" do Enviar lote: o mesmo teste de vida da importação, sem enviar nada.
// Devolve uma linha por proxy (host:porta, estado e motivo); a credencial nunca volta.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const lidas = parseProxies(body.proxies);
  if ("error" in lidas) return NextResponse.json({ error: lidas.error }, { status: 400 });
  if (lidas.value.length === 0) return NextResponse.json({ error: "Cole ao menos uma proxy." }, { status: 400 });
  if (lidas.value.length > MAX_LINHAS) return NextResponse.json({ error: `No máximo ${MAX_LINHAS} proxies por teste.` }, { status: 400 });

  const resultados = await testarProxies(lidas.value.map((p) => p.url));
  return NextResponse.json({
    resultados: lidas.value.map((p, i) => ({
      linha: i + 1,
      hostPorta: `${p.host}:${p.porta}`,
      estado: resultados[i].estado,
      motivo: resultados[i].motivo,
      ms: resultados[i].ms,
      entra: entraNoLote(resultados[i].estado),
    })),
  });
}

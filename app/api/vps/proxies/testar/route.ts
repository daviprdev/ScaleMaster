import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LOTE_MAX, derivarProxy, parseProxies, parseSufixo, parseTipoProxy, sessoesDoLote, type ProxyLida } from "@/lib/vps/input";
import { diagnosticar, entraNoLote, testarProxies } from "@/lib/vps/testar-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 25 s por tentativa, mais 2 com 5 s, e a leitura de IP/país: uma proxy morta leva ~85 s (o nginx espera 300 s).
export const maxDuration = 150;

/** Teto de linhas por teste (o lote usa até LOTE_MAX e as excedentes cobrem as mortas). */
const MAX_LINHAS = LOTE_MAX * 2;

// POST { proxies, tipo, sufixo, quantidade?, sessoes? } — "Testar todas" do Enviar lote, sem enviar nada.
// Com sufixo: uma sessão derivada por conta (`quantidade` = linhas de código; sem códigos, uma por linha base),
// reaproveitando `sessoes` já testadas. Sem sufixo: uma proxy por linha. Cada linha volta com estado, motivo, IP,
// país e se a sessão rotacionou (testada duas vezes). A credencial nunca volta.
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
  const tipo = parseTipoProxy(body.tipo);
  const sufixo = parseSufixo(body.sufixo);
  if ("error" in sufixo) return NextResponse.json({ error: sufixo.error }, { status: 400 });
  const lidas = parseProxies(body.proxies, { tipo, dedupe: !sufixo.value });
  if ("error" in lidas) return NextResponse.json({ error: lidas.error }, { status: 400 });
  if (lidas.value.length === 0) return NextResponse.json({ error: "Cole ao menos uma proxy." }, { status: 400 });

  let alvos: ProxyLida[] = lidas.value;
  if (sufixo.value) {
    const pedida = Number(body.quantidade);
    const quantidade = Number.isInteger(pedida) && pedida >= 1 ? Math.min(pedida, LOTE_MAX) : Math.min(lidas.value.length, LOTE_MAX);
    alvos = sessoesDoLote(quantidade, body.sessoes).map((sessao, i) => derivarProxy(lidas.value[i % lidas.value.length], sufixo.value, sessao));
  }
  if (alvos.length > MAX_LINHAS) return NextResponse.json({ error: `No máximo ${MAX_LINHAS} proxies por teste.` }, { status: 400 });

  const resultados = await testarProxies(alvos.map((p) => p.url));
  // Nada passou: um teste a mais diz se é o tipo da porta ou o formato do sufixo de sessão.
  const diagnostico = await diagnosticar(resultados, lidas.value[0], sufixo.value).catch(() => null);
  return NextResponse.json({
    modoSessao: !!sufixo.value,
    diagnostico,
    resultados: alvos.map((p, i) => ({
      n: i + 1,
      linha: p.linhaBase ?? i + 1,
      hostPorta: `${p.host}:${p.porta}`,
      sessao: p.sessao ?? null,
      estado: resultados[i].estado,
      motivo: resultados[i].motivo,
      ms: resultados[i].ms,
      ip: resultados[i].ip ?? null,
      pais: resultados[i].pais ?? null,
      rotacao: !!resultados[i].rotacao,
      aviso: resultados[i].aviso ?? null,
      entra: entraNoLote(resultados[i].estado),
    })),
  });
}

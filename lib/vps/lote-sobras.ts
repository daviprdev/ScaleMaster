/**
 * O que fica nas caixas do "Enviar lote" depois do envio (16/11). As linhas
 * contam como no parse (vazias não contam, numeradas a partir de 1).
 *   - códigos: saem as `enviadas` primeiras (o resto fica para o próximo envio);
 *   - proxies (sem sessão): as que ficaram fora (morta, lenta, credencial, recusada, em uso)
 *     saem sempre — vão para a lista à parte com o motivo; as usadas saem quando
 *     "remover proxies usadas da lista" está marcado.
 */
export interface ProblemaProxy {
  linha: number;
  hostPorta: string;
  estado: string;
  motivo: string;
  /** Sessão fixa (8 hex) quando o lote usa sufixo: `linha` é a da credencial base. */
  sessao?: string;
}

export interface RespostaLote {
  enviadas: number;
  linhasUsadas: number[];
  problemas: ProblemaProxy[];
  /** Com sufixo de sessão as linhas de proxy são credenciais base: ficam todas (quem queima é a sessão). */
  modoSessao?: boolean;
}

function linhasCheias(texto: string): string[] {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function sobrasDoLote(codigos: string, proxies: string, resposta: RespostaLote, removerUsadas: boolean): { codigos: string; proxies: string } {
  const codigosRestantes = linhasCheias(codigos).slice(Math.max(0, resposta.enviadas));
  if (resposta.modoSessao) return { codigos: codigosRestantes.join("\n"), proxies };
  const fora = new Set(resposta.problemas.map((p) => p.linha));
  const usadas = new Set(removerUsadas ? resposta.linhasUsadas : []);
  const proxiesRestantes = linhasCheias(proxies).filter((_, i) => !fora.has(i + 1) && !usadas.has(i + 1));
  return { codigos: codigosRestantes.join("\n"), proxies: proxiesRestantes.join("\n") };
}

/** Sessões que sobram na lista do "Testar todas" depois do envio: as usadas saem (queimadas). */
export function sessoesRestantes<T extends { sessao?: string | null }>(lista: readonly T[], usadas: readonly string[]): T[] {
  const fora = new Set(usadas);
  return lista.filter((l) => !l.sessao || !fora.has(l.sessao));
}

/** Rótulo curto do estado para a lista das que ficaram fora. */
export function rotuloEstadoProxy(estado: string): string {
  const rotulos: Record<string, string> = {
    morta: "morta",
    lenta: "lenta",
    credencial: "usuário/senha",
    recusada: "host/porta",
    "em-uso": "em uso",
    limitada: "limitada (429)",
    viva: "viva",
  };
  return rotulos[estado] ?? estado;
}

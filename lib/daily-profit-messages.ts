// Mensagens variadas do resumo diário (estilo Utmify) — tom muda conforme o
// dia: sem vendas, abaixo de ontem, ou crescendo em relação a ontem.
// Sem dados de custo (decisão do usuário) — nunca é "prejuízo" de verdade,
// só o tom fica mais ameno em dias fracos.

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ZERO_SALES = [
  "Hoje não rolou nenhuma venda. Amanhã a gente vira o jogo! 💪",
  "Zero vendas hoje — dia parado. Bora resetar e atacar amanhã!",
  "Hoje foi zero a zero no faturamento. Sem crise, amanhã é outro dia.",
  "Nenhuma venda hoje. Hora de revisar a estratégia e tentar de novo amanhã.",
];

const BELOW_YESTERDAY = (v: string) => [
  `Hoje fechou em R$ ${v} — um pouco abaixo de ontem, mas seguimos!`,
  `Faturou R$ ${v} hoje. Não foi o melhor dia, mas toda venda conta.`,
  `R$ ${v} no bolso hoje. Esfriou um pouco comparado a ontem, mas tá valendo.`,
  `Fechamos com R$ ${v} hoje. Dia mais tranquilo, mas positivo.`,
];

const ABOVE_YESTERDAY = (v: string) => [
  `Boa! Fechamos o dia com R$ ${v}, subindo em relação a ontem 🚀`,
  `Que isso! R$ ${v} de faturamento hoje, superando ontem.`,
  `Dia forte! R$ ${v} faturados, crescendo em relação a ontem 💪`,
  `R$ ${v} no caixa hoje — melhor que ontem, bora manter o ritmo!`,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getDailyProfitMessage(total: number, yesterdayTotal: number): { title: string; body: string } {
  const v = formatBRL(total);
  let body: string;
  if (total <= 0) {
    body = pick(ZERO_SALES);
  } else if (total > yesterdayTotal) {
    body = pick(ABOVE_YESTERDAY(v));
  } else {
    body = pick(BELOW_YESTERDAY(v));
  }
  return { title: "Fechamento do dia", body };
}

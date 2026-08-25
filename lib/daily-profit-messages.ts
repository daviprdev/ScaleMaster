// Mensagens do resumo diário (estilo Utmify) — sempre tom positivo, só varia
// a frase pra não ficar repetitivo. Sem comparação com ontem e sem dado de
// custo (decisões do usuário), então é sempre o valor bruto de vendas do dia.

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESSAGES = (v: string) => [
  `Que isso, Magnata! Fechamos o dia com R$ ${v} de lucro, nada mal 💪`,
  `Boa! R$ ${v} de faturamento hoje. Bora manter esse ritmo!`,
  `Dia fechado com R$ ${v} no caixa. Mandou bem! 🚀`,
  `R$ ${v} faturados hoje. Simbora que amanhã tem mais!`,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getDailyProfitMessage(total: number): { title: string; body: string } {
  const v = formatBRL(total);
  return { title: "📊 Fechamento do dia 🚀", body: pick(MESSAGES(v)) };
}

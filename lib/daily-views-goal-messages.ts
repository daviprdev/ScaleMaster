// Mensagens da notificação de meta de views batida — primeira frase em negrito
// via markdown (*bold*), números formatados com separador de milhar pt-BR.

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

export function getDailyViewsGoalMessage(
  currentViews: number,
  goal: number
): { title: string; body: string } {
  const current = formatNumber(currentViews);
  const target = formatNumber(goal);
  return {
    title: "Meta de views batida! 🎉",
    body: `*Meta de views batida! 🎉*\nVocê ja tem ${current} visualizações hoje\n(meta: ${target})`,
  };
}
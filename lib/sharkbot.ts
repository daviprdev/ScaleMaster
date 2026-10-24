// Formato do webhook da SharkBot, conferido nos avisos reais de 20/10/2026:
// tudo vem dentro de `data`, e `transaction.amount` já vem em reais (float) —
// também nos bots da gringa, a própria SharkBot converte.
// Eventos: só "payment_approved" é venda confirmada.
export interface SharkBotPayload {
  event?: string;
  timestamp?: number;
  webhook_id?: string;
  data?: {
    customer?: {
      id?: string;
      telegram_id?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
      phone?: string;
    };
    transaction?: {
      id?: string;
      external_id?: string;
      status?: string;
      amount?: number;
      currency?: string;
      plan_name?: string;
    };
  };
}

// Contas da SharkBot ligadas ao SaaS. Cada uma cola o seu link nos bots dela
// (/api/webhooks/sharkbot/<token> e /<token>/gringa); as vendas das duas caem
// na mesma tabela e somam juntas na dashboard — `source` só diz de onde veio.
export const SHARKBOT_ACCOUNTS = {
  principal: { source: "sharkbot", label: "SharkBot" },
  gringa: { source: "sharkbot_gringa", label: "SharkBot Gringa" },
} as const;

export type SharkBotAccount = keyof typeof SHARKBOT_ACCOUNTS;

export interface SharkBotSale {
  externalId: string | null;
  amount: number | null;
  currency: string;
  customerIdentifier: string | null;
}

export function parseSharkBotSale(payload: SharkBotPayload): SharkBotSale {
  const tx = payload.data?.transaction ?? {};
  const customer = payload.data?.customer ?? {};
  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || null;

  return {
    externalId: tx.id ?? null,
    // Chega como 11.870000000000001 — arredonda para centavos.
    amount: typeof tx.amount === "number" ? Math.round(tx.amount * 100) / 100 : null,
    currency: tx.currency ?? "BRL",
    customerIdentifier: customer.username ?? fullName ?? customer.telegram_id ?? customer.phone ?? null,
  };
}

import { rateToBrl } from "./fx-rate";

// Formato do webhook da SharkBot, conferido nos avisos reais de 20/10/2026:
// tudo vem dentro de `data`, e `transaction.amount` vem na moeda de
// `transaction.currency` (reais nos bots do Brasil), como float.
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
  const currency = String(tx.currency ?? "BRL").trim().toUpperCase();

  return {
    externalId: tx.id ?? null,
    // Chega como 11.870000000000001 — arredonda para centavos.
    amount: typeof tx.amount === "number" ? Math.round(tx.amount * 100) / 100 : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "BRL",
    customerIdentifier: customer.username ?? fullName ?? customer.telegram_id ?? customer.phone ?? null,
  };
}

/**
 * Valor da venda em reais — é o que vai para `sales.amount`. Venda em outra
 * moeda (bots da gringa) é convertida na cotação da hora; o valor original
 * continua no raw_payload. Null quando não há valor ou cotação.
 */
export async function saleAmountBrl(
  sale: SharkBotSale,
  getRate: (currency: string) => Promise<number | null> = rateToBrl
): Promise<number | null> {
  if (sale.amount == null) return null;
  if (sale.currency === "BRL") return sale.amount;
  const rate = await getRate(sale.currency);
  return rate == null ? null : Math.round(sale.amount * rate * 100) / 100;
}

const formatMoney = (value: number, currency: string) =>
  value.toLocaleString("pt-BR", { style: "currency", currency });

/** Texto da notificação: "R$ 11,87", ou "US$ 9,90 · R$ 49,16" em venda da gringa. */
export function saleNotificationBody(sale: SharkBotSale, amountBrl: number | null): string {
  if (sale.amount == null) return "Novo pagamento recebido.";
  if (sale.currency === "BRL") return formatMoney(sale.amount, "BRL");
  const original = formatMoney(sale.amount, sale.currency);
  return amountBrl == null ? original : `${original} · ${formatMoney(amountBrl, "BRL")}`;
}

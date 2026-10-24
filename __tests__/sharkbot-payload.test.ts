import { describe, it, expect } from "vitest";
import { parseSharkBotSale, type SharkBotPayload } from "../lib/sharkbot";

// Mesma estrutura dos avisos reais da SharkBot recebidos em 20/10/2026
// (valores de cliente trocados por exemplos).
const approved: SharkBotPayload = {
  event: "payment_approved",
  timestamp: 1792468471,
  webhook_id: "wh_1",
  data: {
    customer: { id: "lead_1", telegram_id: "123456789", first_name: "João", last_name: "Silva" },
    transaction: { id: "tx_1", external_id: "gw_1", status: "paid", amount: 11.870000000000001, currency: "BRL" },
  },
};

describe("parseSharkBotSale", () => {
  it("lê o valor em reais de data.transaction e arredonda para centavos", () => {
    expect(parseSharkBotSale(approved)).toEqual({
      externalId: "tx_1",
      amount: 11.87,
      currency: "BRL",
      customerIdentifier: "João Silva",
    });
  });

  it("usa o username quando vem, e o telegram_id quando não há nome", () => {
    const withUser = { ...approved, data: { ...approved.data, customer: { username: "joao", first_name: "João" } } };
    expect(parseSharkBotSale(withUser).customerIdentifier).toBe("joao");
    const onlyId = { ...approved, data: { ...approved.data, customer: { telegram_id: "999" } } };
    expect(parseSharkBotSale(onlyId).customerIdentifier).toBe("999");
  });

  it("sem transação devolve valor nulo em vez de quebrar", () => {
    expect(parseSharkBotSale({ event: "payment_approved" })).toEqual({
      externalId: null,
      amount: null,
      currency: "BRL",
      customerIdentifier: null,
    });
  });
});

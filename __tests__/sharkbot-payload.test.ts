import { describe, it, expect, vi } from "vitest";
import {
  parseSharkBotSale,
  saleAmountBrl,
  saleNotificationBody,
  type SharkBotPayload,
  type SharkBotSale,
} from "../lib/sharkbot";

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

  it("normaliza a moeda e cai em BRL quando ela vem estranha", () => {
    const tx = approved.data!.transaction!;
    const withCurrency = (currency: string) => ({ ...approved, data: { ...approved.data, transaction: { ...tx, currency } } });
    expect(parseSharkBotSale(withCurrency(" usd ")).currency).toBe("USD");
    expect(parseSharkBotSale(withCurrency("R$")).currency).toBe("BRL");
  });
});

// toLocaleString separa símbolo e número com espaço não separável.
const plain = (s: string) => s.replace(/\s/g, " ");

const brSale: SharkBotSale = { externalId: "tx_1", amount: 11.87, currency: "BRL", customerIdentifier: null };
const usdSale: SharkBotSale = { externalId: "tx_2", amount: 9.9, currency: "USD", customerIdentifier: null };

describe("saleAmountBrl", () => {
  it("venda em reais passa direto, sem buscar cotação", async () => {
    const getRate = vi.fn();
    expect(await saleAmountBrl(brSale, getRate)).toBe(11.87);
    expect(getRate).not.toHaveBeenCalled();
  });

  it("venda da gringa entra convertida para reais, arredondada em centavos", async () => {
    // 9,90 × 4,9652 = 49,15548
    expect(await saleAmountBrl(usdSale, async () => 4.9652)).toBe(49.16);
  });

  it("sem cotação ou sem valor fica nula (não soma dólar como real)", async () => {
    expect(await saleAmountBrl(usdSale, async () => null)).toBeNull();
    expect(await saleAmountBrl({ ...usdSale, amount: null }, async () => 5)).toBeNull();
  });
});

describe("saleNotificationBody", () => {
  it("mostra reais na venda do Brasil", () => {
    expect(plain(saleNotificationBody(brSale, 11.87))).toBe("R$ 11,87");
  });

  it("mostra o valor original e o convertido na venda da gringa", () => {
    expect(plain(saleNotificationBody(usdSale, 49.16))).toBe("US$ 9,90 · R$ 49,16");
    expect(plain(saleNotificationBody(usdSale, null))).toBe("US$ 9,90");
  });

  it("sem valor avisa só que entrou pagamento", () => {
    expect(saleNotificationBody({ ...brSale, amount: null }, null)).toBe("Novo pagamento recebido.");
  });
});

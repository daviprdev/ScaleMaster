import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateToBrl } from "../lib/fx-rate";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("rateToBrl", () => {
  beforeEach(() => {
    delete (globalThis as { __fxRates?: unknown }).__fxRates;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("real vale 1 e código inválido não busca nada", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await rateToBrl("BRL")).toBe(1);
    expect(await rateToBrl("US$")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("usa o bid da AwesomeAPI e guarda a cotação", async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ USDBRL: { bid: "4.9652" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await rateToBrl("usd")).toBe(4.9652);
    expect(await rateToBrl("USD")).toBe(4.9652);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/json/last/USD-BRL");
  });

  it("cai na open.er-api quando a AwesomeAPI falha", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("awesomeapi") ? jsonResponse({ status: 429 }, 429) : jsonResponse({ rates: { BRL: 5.56 } })
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await rateToBrl("EUR")).toBe(5.56);
  });

  it("sem nenhuma fonte e sem cotação guardada devolve null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await rateToBrl("GBP")).toBeNull();
  });
});

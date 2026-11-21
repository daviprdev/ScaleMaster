import { describe, expect, it } from "vitest";
import { describePublishError, isUserProxyFailure, transientRetryAt } from "../lib/publish-retry";

describe("isUserProxyFailure", () => {
  it("falha de conexão em post com proxy do estoque", () => {
    expect(isUserProxyFailure("[RETRY] fetch failed", true)).toBe(true);
    expect(isUserProxyFailure("[RETRY] [PROXY do estoque] fetch failed (ECONNREFUSED)", true)).toBe(true);
    expect(isUserProxyFailure("[RETRY] fetch failed (Proxy response (407) !== 200)", true)).toBe(true);
  });
  it("sem proxy do estoque, ou erro da Meta, não é falha de proxy", () => {
    expect(isUserProxyFailure("[RETRY] fetch failed", false)).toBe(false);
    expect(isUserProxyFailure("[RETRY] fetch failed", null)).toBe(false);
    expect(isUserProxyFailure("[RETRY] Application request limit reached. Please retry", true)).toBe(false);
    expect(isUserProxyFailure(null, true)).toBe(false);
  });
});

describe("describePublishError", () => {
  it("anexa code e message da causa do undici ao 'fetch failed'", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:8080"), { code: "ECONNREFUSED" }) });
    expect(describePublishError(err)).toBe("fetch failed (ECONNREFUSED: connect ECONNREFUSED 1.2.3.4:8080)");
  });
  it("mostra o 407 da proxy", () => {
    const err = new TypeError("fetch failed", { cause: new Error("Proxy response (407) !== 200 when HTTP Tunneling") });
    expect(describePublishError(err)).toContain("Proxy response (407)");
  });
  it("sem causa, devolve a mensagem como está", () => {
    expect(describePublishError(new Error("Invalid OAuth access token"))).toBe("Invalid OAuth access token");
    expect(describePublishError("texto")).toBe("texto");
  });
});

describe("transientRetryAt", () => {
  const now = Date.parse("2026-11-21T00:20:00Z");
  it("erro de rede/proxy sai da frente da fila: +60 s a +120 s", () => {
    expect(transientRetryAt("fetch failed (ECONNREFUSED)", now, () => 0)).toBe("2026-11-21T00:21:00.000Z");
    expect(Date.parse(transientRetryAt("fetch failed", now, () => 0.999)) - now).toBeLessThan(120_000);
  });
  it("rate-limit da Meta mantém +120 s a +180 s", () => {
    expect(transientRetryAt("Application request limit reached. Please retry", now, () => 0)).toBe("2026-11-21T00:22:00.000Z");
  });
});

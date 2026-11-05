import { describe, it, expect, beforeAll } from "vitest";
import {
  signOAuthState,
  verifyOAuthState,
  signMagicUserCookie,
  verifyMagicUserCookie,
} from "../lib/oauth-cookie";

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = "teste-oauth-state";
});

describe("state assinado do OAuth do Instagram", () => {
  it("aceita o state que o servidor acabou de gerar", () => {
    expect(verifyOAuthState(signOAuthState())).toBe(true);
  });

  it("gera um state diferente a cada clique", () => {
    expect(signOAuthState()).not.toBe(signOAuthState());
  });

  it("recusa o UUID solto de antes (sem assinatura)", () => {
    expect(verifyOAuthState(crypto.randomUUID())).toBe(false);
  });

  it("recusa state com nonce ou horário trocado", () => {
    const [nonce, ts, sig] = signOAuthState().split(".");
    expect(verifyOAuthState(`${crypto.randomUUID()}.${ts}.${sig}`)).toBe(false);
    expect(verifyOAuthState(`${nonce}.${Date.now().toString(36)}x.${sig}`)).toBe(false);
  });

  it("recusa state assinado com outra chave", () => {
    const state = signOAuthState();
    process.env.ENCRYPTION_SECRET = "outra-chave";
    expect(verifyOAuthState(state)).toBe(false);
    process.env.ENCRYPTION_SECRET = "teste-oauth-state";
  });

  it("vale por 1h e recusa depois", () => {
    const t0 = Date.UTC(2026, 10, 5, 12);
    const state = signOAuthState(t0);
    expect(verifyOAuthState(state, t0 + 59 * 60 * 1000)).toBe(true);
    expect(verifyOAuthState(state, t0 + 61 * 60 * 1000)).toBe(false);
  });

  it("recusa state do futuro (além da folga de relógio)", () => {
    const t0 = Date.UTC(2026, 10, 5, 12);
    expect(verifyOAuthState(signOAuthState(t0 + 10 * 60 * 1000), t0)).toBe(false);
  });

  it("recusa lixo", () => {
    expect(verifyOAuthState("")).toBe(false);
    expect(verifyOAuthState("a.b")).toBe(false);
    expect(verifyOAuthState("a.b.c.d")).toBe(false);
  });
});

describe("cookie do link mágico continua igual", () => {
  it("devolve o userId quando state e app batem", () => {
    const state = signOAuthState();
    const cookie = signMagicUserCookie("user-1", state, "app-1");
    expect(verifyMagicUserCookie(cookie, state, "app-1")).toBe("user-1");
    expect(verifyMagicUserCookie(cookie, state, "app-2")).toBeNull();
    expect(verifyMagicUserCookie(cookie, signOAuthState(), "app-1")).toBeNull();
  });
});

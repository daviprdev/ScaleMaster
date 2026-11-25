import { describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

import { isAccountDeadError } from "@/lib/account-health";
import { isDeadSubscription } from "@/lib/web-push";

describe("isAccountDeadError — API desativada", () => {
  it("marca 'API access deactivated' como conta caída", () => {
    expect(isAccountDeadError("API access deactivated.")).toBe(true);
    expect(isAccountDeadError("http=400 | code=200 | API access deactivated.")).toBe(true);
  });
  it("segue sem marcar erro de infra nem 'Unsupported request'", () => {
    expect(isAccountDeadError("Unsupported request - method type: post")).toBe(false);
    expect(isAccountDeadError("Failed to decrypt token")).toBe(false);
  });
});

describe("isDeadSubscription", () => {
  it("poda 404/410", () => {
    expect(isDeadSubscription(404, "")).toBe(true);
    expect(isDeadSubscription(410, "")).toBe(true);
  });
  it("poda inscrição feita com outra chave VAPID", () => {
    expect(isDeadSubscription(400, '{"reason":"VapidPkHashMismatch"}')).toBe(true);
    expect(
      isDeadSubscription(403, "the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.")
    ).toBe(true);
  });
  it("não poda erro passageiro ou de configuração do servidor", () => {
    expect(isDeadSubscription(400, '{"reason":"BadJwtToken"}')).toBe(false);
    expect(isDeadSubscription(403, '{"reason":"ExpiredProviderToken"}')).toBe(false);
    expect(isDeadSubscription(429, "")).toBe(false);
    expect(isDeadSubscription(500, "")).toBe(false);
  });
});

import { bloqueioNaBorda, limitesDoCaminho, type Limitador } from "@/lib/limites-borda";

const sempre = (ok: boolean): Limitador => ({ limit: async () => ({ success: ok }) });

describe("limites da borda (no lugar do Nginx)", () => {
  const env = {
    LIMITE_LOGIN: sempre(true), LIMITE_LOGIN_GERAL: sempre(true), LIMITE_AUTH: sempre(true),
    LIMITE_BUSCA: sempre(true), LIMITE_POLL: sempre(true), LIMITE_VIDEO: sempre(true),
  };
  it("mapeia as mesmas rotas das locations do Nginx", () => {
    expect(limitesDoCaminho("/api/auth/login", "1.2.3.4", env).map(([, k]) => k)).toEqual(["1.2.3.4", "todos"]);
    expect(limitesDoCaminho("/auth/callback", "1.2.3.4", env)).toHaveLength(2);
    expect(limitesDoCaminho("/api/auth/logout", "ip", env)[0][0]).toBe(env.LIMITE_AUTH);
    expect(limitesDoCaminho("/api/inspirations/scrape", "ip", env)[0][0]).toBe(env.LIMITE_BUSCA);
    expect(limitesDoCaminho("/api/inspirations/scrape-account/poll", "ip", env)[0][0]).toBe(env.LIMITE_POLL);
    expect(limitesDoCaminho("/api/clone/search", "ip", env)[0][0]).toBe(env.LIMITE_BUSCA);
    expect(limitesDoCaminho("/api/cron/publish-scheduled", "ip", env)).toEqual([]);
    expect(limitesDoCaminho("/dashboard", "ip", env)).toEqual([]);
  });
  it("429 quando o limite estoura, 413 acima de 10 MB, null no resto", async () => {
    const req = (path: string, headers: Record<string, string> = {}) =>
      new Request(`https://scalemaster.tech${path}`, { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4", ...headers } });
    expect((await bloqueioNaBorda(req("/api/auth/login"), { ...env, LIMITE_LOGIN: sempre(false) }))?.status).toBe(429);
    expect((await bloqueioNaBorda(req("/api/auth/login"), { ...env, LIMITE_LOGIN_GERAL: sempre(false) }))?.status).toBe(429);
    expect((await bloqueioNaBorda(req("/api/posts", { "content-length": String(11 * 1024 * 1024) }), env))?.status).toBe(413);
    expect(await bloqueioNaBorda(req("/api/auth/login"), env)).toBeNull();
    expect(await bloqueioNaBorda(req("/api/auth/login"), {})).toBeNull();
  });
});

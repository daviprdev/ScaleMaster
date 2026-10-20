import { describe, it, expect } from "vitest";
import {
  computePauseUntil,
  isMetaLimitError,
  getPublishPause,
  listPublishPauses,
  ACTION_PAUSE_MIN_MS,
  ACTION_PAUSE_MAX_MS,
  FALLBACK_PAUSE_MS,
} from "../lib/publish-limits";

const MIN = 60_000;
const H = 60 * MIN;
const NOW = Date.parse("2026-10-20T03:00:00Z");

/** 50 posts a cada 29 min, o mais antigo há `oldestAgoMs`. */
function steadyPosts(oldestAgoMs: number, count = 50, spacing = 29 * MIN): number[] {
  return Array.from({ length: count }, (_, i) => NOW - oldestAgoMs + i * spacing);
}

describe("isMetaLimitError", () => {
  it("reconhece o freio antispam e a cota oficial", () => {
    expect(isMetaLimitError("User is performing too many actions")).toBe(true);
    expect(isMetaLimitError("Application has reached the publishing limit")).toBe(true);
    expect(isMetaLimitError("(#9) subcode 2207042")).toBe(true);
  });

  it("não confunde com erros de proxy, token ou vídeo", () => {
    expect(isMetaLimitError("fetch failed")).toBe(false);
    expect(isMetaLimitError("Error validating access token: Session has expired")).toBe(false);
    expect(isMetaLimitError("Processamento de vídeo falhou com status: ERROR.")).toBe(false);
  });
});

describe("computePauseUntil", () => {
  it("cota cheia: volta quando o post mais antigo da janela completa 24h", () => {
    const posts = steadyPosts(23 * H + 40 * MIN); // o mais antigo libera em 20 min
    const until = computePauseUntil({ cause: "quota", now: NOW, recentPostTimes: posts });
    expect(until - NOW).toBe(20 * MIN + MIN); // + 1 min de folga
  });

  it("freio antispam: mesma vaga, mas nunca menos que o mínimo", () => {
    const posts = steadyPosts(23 * H + 55 * MIN); // vaga em 5 min
    const until = computePauseUntil({ cause: "action", now: NOW, recentPostTimes: posts });
    expect(until - NOW).toBe(ACTION_PAUSE_MIN_MS);
  });

  it("freio antispam com poucos posts: limita a pausa ao máximo", () => {
    const posts = [NOW - 10 * MIN, NOW - 30 * MIN]; // vaga só em ~23h40
    const until = computePauseUntil({ cause: "action", now: NOW, recentPostTimes: posts });
    expect(until - NOW).toBe(ACTION_PAUSE_MAX_MS);
  });

  it("ignora posts fora da janela de 24h", () => {
    const posts = [NOW - 30 * H, NOW - 25 * H, NOW - 23 * H];
    const until = computePauseUntil({ cause: "quota", now: NOW, recentPostTimes: posts });
    expect(until - NOW).toBe(H + MIN);
  });

  it("sem histórico de posts: pausa padrão", () => {
    expect(computePauseUntil({ cause: "quota", now: NOW, recentPostTimes: [] }) - NOW).toBe(FALLBACK_PAUSE_MS);
    expect(computePauseUntil({ cause: "action", now: NOW, recentPostTimes: [] }) - NOW).toBe(FALLBACK_PAUSE_MS);
  });

  it("a ordem dos horários não importa", () => {
    const posts = steadyPosts(23 * H + 40 * MIN);
    const a = computePauseUntil({ cause: "quota", now: NOW, recentPostTimes: posts });
    const b = computePauseUntil({ cause: "quota", now: NOW, recentPostTimes: posts.slice().reverse() });
    expect(a).toBe(b);
  });
});

describe("estado das pausas", () => {
  it("conta sem pausa não aparece", () => {
    expect(getPublishPause("conta-inexistente")).toBeNull();
    expect(listPublishPauses(["conta-inexistente"])).toEqual({});
  });
});

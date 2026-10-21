import { describe, it, expect } from "vitest";
import {
  fmtAgoMin,
  fmtReadAfterPublish,
  isInitialRead,
} from "../components/dashboard/queue-insights/format";

const NOW = new Date("2026-10-21T15:00:00Z");
const minus = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe("Raio-X — frescor das views (format.ts)", () => {
  it("fmtAgoMin mostra minuto na primeira hora e cai no fmtAgo depois", () => {
    expect(fmtAgoMin(minus(0), NOW)).toBe("agora há pouco");
    expect(fmtAgoMin(minus(3), NOW)).toBe("há 3 min");
    expect(fmtAgoMin(minus(59), NOW)).toBe("há 59 min");
    expect(fmtAgoMin(minus(60), NOW)).toBe("há 1h");
    expect(fmtAgoMin(minus(3 * 60 + 20), NOW)).toBe("há 3h");
    expect(fmtAgoMin(minus(2 * 24 * 60), NOW)).toBe("há 2 dias");
  });

  it("fmtReadAfterPublish mede publicação → leitura", () => {
    const pub = minus(300);
    expect(fmtReadAfterPublish(pub, minus(298))).toBe("2 min após publicar");
    expect(fmtReadAfterPublish(pub, minus(210))).toBe("1h30 após publicar");
    expect(fmtReadAfterPublish(pub, minus(300))).toBe("logo após publicar");
    // Loop com horário estimado: leitura "antes" da publicação não vira número negativo.
    expect(fmtReadAfterPublish(pub, minus(303))).toBe("logo após publicar");
    expect(fmtReadAfterPublish(minus(4 * 24 * 60), minus(24 * 60))).toBe("3 dias após publicar");
    expect(fmtReadAfterPublish(minus(30 * 60), minus(0))).toBe("1 dia após publicar");
  });

  it("isInitialRead usa a régua de 4h do post maduro", () => {
    const pub = minus(10 * 60);
    expect(isInitialRead(pub, minus(10 * 60 - 2))).toBe(true);
    expect(isInitialRead(pub, minus(6 * 60 + 1))).toBe(true);
    expect(isInitialRead(pub, minus(6 * 60))).toBe(false);
    expect(isInitialRead(pub, null)).toBe(false);
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APK_VALIDADE_MS, apkGuardado } from "../agente-mumu/fluxos/aurora.mjs";

describe("Cópia do Instagram guardada no PC", () => {
  const pasta = () => mkdtempSync(path.join(os.tmpdir(), "sm-apk-"));

  it("sem cópia, ou com cópia incompleta, vai pelo Aurora (null)", () => {
    expect(apkGuardado(Date.now(), pasta())).toBeNull();
    const p = pasta();
    writeFileSync(path.join(p, "base.apk"), "x");
    writeFileSync(path.join(p, "meta.json"), JSON.stringify({ guardadoEm: Date.now(), arquivos: 2 }));
    expect(apkGuardado(Date.now(), p)).toBeNull();
  });

  it("cópia inteira vale por 7 dias e depois vence", () => {
    const p = pasta();
    const t = 1_800_000_000_000;
    writeFileSync(path.join(p, "base.apk"), "x");
    writeFileSync(path.join(p, "split_config.x86_64.apk"), "x");
    writeFileSync(path.join(p, "meta.json"), JSON.stringify({ guardadoEm: t, arquivos: 2 }));
    expect(apkGuardado(t + 1000, p)).toEqual([path.join(p, "base.apk"), path.join(p, "split_config.x86_64.apk")]);
    expect(apkGuardado(t + APK_VALIDADE_MS + 1, p)).toBeNull();
  });
});

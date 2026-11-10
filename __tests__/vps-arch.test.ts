import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abiEsperada, archDe, conferirAbi, conferirAbiNoAparelho, imagemPorArch } from "../agente-vps/lib/android.mjs";
import { ARQUIVOS_X86, arquivosX86, conferirSha256, instalarInstagram, versoesDisponiveis } from "../agente-vps/fluxos/apk.mjs";
import { capacidade } from "../agente-vps/lib/supervisor.mjs";

/**
 * Host x86_64 (Hostinger KVM 2) x arm64 (Hetzner CAX31): imagem do redroid,
 * checagem de ABI depois do boot, APK por arquitetura (x86 dividido com
 * sha256) e a regra de capacidade.
 */

const APKS = mkdtempSync(path.join(os.tmpdir(), "sm-apks-"));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeAll(() => {
  // x86: pasta x86-<versão> com base + split e os .sha256 ao lado (formato do sha256sum).
  const dir = path.join(APKS, "x86-454.0.0.54.77");
  mkdirSync(dir);
  for (const nome of ARQUIVOS_X86) {
    const conteudo = Buffer.from(`apk ${nome}`);
    writeFileSync(path.join(dir, nome), conteudo);
    writeFileSync(path.join(dir, `${nome}.sha256`), `${sha(conteudo)}  ${nome}\n`);
  }
  // Pasta x86 sem base.apk não conta; APK único (ARM) não aparece em x86.
  mkdirSync(path.join(APKS, "x86-1.0.0"));
  writeFileSync(path.join(APKS, "instagram-309.0.0.40.113.apk"), "arm");
  writeFileSync(path.join(APKS, "instagram-300.0.0.1.1.apk"), "arm");
  writeFileSync(path.join(APKS, "ATUAL"), "300.0.0.1.1\n");
});
afterAll(() => rmSync(APKS, { recursive: true, force: true }));

describe("Contas VPS: arquitetura do host", () => {
  it("imagem do redroid por arch (x86_64 → 13.0.0-latest, arm64 → _64only)", () => {
    expect(imagemPorArch("x64")).toBe("redroid/redroid:13.0.0-latest");
    expect(imagemPorArch("x86_64")).toBe("redroid/redroid:13.0.0-latest");
    expect(imagemPorArch("amd64")).toBe("redroid/redroid:13.0.0-latest");
    expect(imagemPorArch("arm64")).toBe("redroid/redroid:13.0.0_64only-latest");
    expect(imagemPorArch("aarch64")).toBe("redroid/redroid:13.0.0_64only-latest");
    expect(archDe("X86_64")).toBe("x86_64");
    expect(() => archDe("riscv64")).toThrow(/sem imagem/);
    expect(abiEsperada("x64")).toBe("x86_64");
    expect(abiEsperada("arm64")).toBe("arm64-v8a");
  });

  it("abilist e primaryCpuAbi conferidos por arch; falha = ABI_AUSENTE", () => {
    // teste-ig real nesta VPS: abilist x86_64,arm64-v8a,x86,armeabi-v7a,armeabi e primaryCpuAbi=x86_64.
    expect(conferirAbi({ abilist: "x86_64,arm64-v8a,x86,armeabi-v7a,armeabi", primaryCpuAbi: "x86_64" }, "x86_64")).toBe("x86_64");
    // Antes de instalar (primaryCpuAbi null) só a abilist conta.
    expect(conferirAbi({ abilist: "x86_64,arm64-v8a" }, "x64")).toBe("x86_64");
    // Build arm64 instalado em host x86: é o que crasha em libnb.so → recusado.
    expect(() => conferirAbi({ abilist: "x86_64,arm64-v8a", primaryCpuAbi: "arm64-v8a" }, "x86_64")).toThrow(/^ABI_AUSENTE: o Instagram instalado é arm64-v8a, esta VPS exige x86_64/);
    expect(() => conferirAbi({ abilist: "arm64-v8a,armeabi-v7a" }, "x86_64")).toThrow(/^ABI_AUSENTE: ro\.product\.cpu\.abilist=arm64-v8a,armeabi-v7a não traz x86_64/);
    expect(() => conferirAbi({ abilist: "" }, "x86_64")).toThrow(/\(vazio\)/);
    expect(conferirAbi({ abilist: "arm64-v8a", primaryCpuAbi: "arm64-v8a" }, "arm64")).toBe("arm64-v8a");
    expect(() => conferirAbi({ abilist: "x86_64,x86" }, "aarch64")).toThrow(/ABI_AUSENTE/);
  });

  it("conferirAbiNoAparelho lê getprop e dumpsys pelo Dispositivo", async () => {
    const d = { prop: async () => "x86_64,arm64-v8a", abiPrimaria: async () => null };
    expect(await conferirAbiNoAparelho(d, "x86_64")).toBe("x86_64");
    const errado = { prop: async () => "x86_64,arm64-v8a", abiPrimaria: async () => "arm64-v8a" };
    await expect(conferirAbiNoAparelho(errado, "x86_64")).rejects.toThrow(/ABI_AUSENTE/);
  });

  it("capacidade: vCPU/2 nas duas arquiteturas (1 a 8 ligadas, 1 a 4 jobs), sem olhar a RAM", () => {
    expect(capacidade({ arch: "x86_64", vcpu: 2, totalMb: 7935, livreMb: 1145 })).toMatchObject({ arch: "x86_64", maxLigadas: 1, maxCadastro: 1 });
    expect(capacidade({ arch: "x64", vcpu: 4, totalMb: 1024, livreMb: 100 })).toMatchObject({ maxLigadas: 2, maxCadastro: 2 });
    expect(capacidade({ arch: "x86_64", vcpu: 16, totalMb: 131072, livreMb: 100000 })).toMatchObject({ maxLigadas: 8, maxCadastro: 4 });
    expect(capacidade({ arch: "aarch64", vcpu: 8, totalMb: 32768, livreMb: 30000 })).toMatchObject({ arch: "arm64", maxLigadas: 4, maxCadastro: 4 });
    expect(capacidade({ arch: "arm64", vcpu: 2, totalMb: 1000, livreMb: 500 })).toMatchObject({ maxLigadas: 1, maxCadastro: 1 });
  });
});

describe("Contas VPS: APK por arquitetura", () => {
  it("versões disponíveis: x86 lista x86-<v>/ com base.apk; arm64 lista instagram-<v>.apk (ATUAL primeiro)", () => {
    expect(versoesDisponiveis(APKS, "x86_64")).toEqual(["454.0.0.54.77"]);
    expect(versoesDisponiveis(APKS, "arm64")).toEqual(["300.0.0.1.1", "309.0.0.40.113"]);
    expect(versoesDisponiveis(path.join(APKS, "nao-existe"), "x64")).toEqual([]);
  });

  it("arquivos x86 na ordem base + split; falta de arquivo ou versão ruim é erro", () => {
    const dir = path.join(APKS, "x86-454.0.0.54.77");
    expect(arquivosX86("454.0.0.54.77", APKS)).toEqual([path.join(dir, "base.apk"), path.join(dir, "split_config.xxhdpi.apk")]);
    expect(() => arquivosX86("1.0.0", APKS)).toThrow(/não tem .*base\.apk/);
    expect(() => arquivosX86("../x", APKS)).toThrow(/inválida/);
  });

  it("sha256 conferido antes de instalar: hash errado ou .sha256 ausente barram", () => {
    const arquivos = arquivosX86("454.0.0.54.77", APKS);
    expect(conferirSha256(arquivos).map((h) => h.sha256)).toEqual(arquivos.map((a) => sha(Buffer.from(`apk ${path.basename(a)}`))));
    const dir = path.join(APKS, "x86-2.0.0");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "base.apk"), "a");
    writeFileSync(path.join(dir, "split_config.xxhdpi.apk"), "b");
    expect(() => conferirSha256(arquivosX86("2.0.0", APKS))).toThrow(/Falta base\.apk\.sha256/);
    writeFileSync(path.join(dir, "base.apk.sha256"), `${"0".repeat(64)}  base.apk\n`);
    expect(() => conferirSha256(arquivosX86("2.0.0", APKS))).toThrow(/sha256 de base\.apk não bate/);
  });

  it("instalarInstagram em x86_64 usa install-multiple e exige primaryCpuAbi=x86_64", async () => {
    const chamadas: string[] = [];
    let abiDepois = "x86_64";
    const d = {
      temApp: async () => chamadas.includes("multiple"),
      shell: async (...a: string[]) => (a[0] === "dumpsys" ? `    versionName=454.0.0.54.77\n    primaryCpuAbi=${abiDepois}\n` : ""),
      abiPrimaria: async () => (chamadas.includes("multiple") ? abiDepois : null),
      instalar: async () => chamadas.push("single"),
      instalarMultiplos: async (arqs: string[]) => chamadas.push("multiple", ...arqs.map((a) => path.basename(a))),
    };
    const logs: string[] = [];
    expect(await instalarInstagram(d, "454.0.0.54.77", (m: string) => logs.push(m), { arch: "x86_64", pasta: APKS })).toBe("Instagram 454.0.0.54.77 instalado (x86_64)");
    expect(chamadas).toEqual(["multiple", "base.apk", "split_config.xxhdpi.apk"]);
    expect(logs.some((l) => /sha256 ok/.test(l))).toBe(true);
    // Já instalado na ABI certa: não reinstala.
    expect(await instalarInstagram(d, "454.0.0.54.77", () => {}, { arch: "x86_64", pasta: APKS })).toMatch(/já estava instalado/);
    // Instalou mas saiu arm64: ABI_AUSENTE.
    chamadas.length = 0;
    abiDepois = "arm64-v8a";
    await expect(instalarInstagram(d, "454.0.0.54.77", () => {}, { arch: "x64", pasta: APKS })).rejects.toThrow(/ABI_AUSENTE/);
    // Sem o sha256 (versão 2.0.0 de cima) nada é instalado.
    chamadas.length = 0;
    await expect(instalarInstagram(d, "2.0.0", () => {}, { arch: "x86_64", pasta: APKS })).rejects.toThrow(/sha256/);
    expect(chamadas).toEqual([]);
  });
});

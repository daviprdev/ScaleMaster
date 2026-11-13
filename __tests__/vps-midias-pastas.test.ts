import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarPastaMidia, listarMidias, nomePastaMidia, pastasDeMidia, salvarMidia } from "../lib/vps/midias";

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
let raiz = "";
afterEach(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true });
  raiz = "";
});

describe("Pastas de mídia (Mídias / Estruturar)", () => {
  it("nome: sem acento, minúsculo, espaço vira hífen, um nível só; vazio ou só símbolo = null", () => {
    expect(nomePastaMidia("Stories Novembro")).toBe("stories-novembro");
    expect(nomePastaMidia("Ação 1")).toBe("acao-1");
    expect(nomePastaMidia("perfil")).toBe("perfil");
    expect(nomePastaMidia("../etc")).toBe("etc");
    expect(nomePastaMidia("a/b")).toBe("a-b");
    expect(nomePastaMidia("   ")).toBeNull();
    expect(nomePastaMidia("///")).toBeNull();
    expect(nomePastaMidia(undefined)).toBeNull();
    expect(nomePastaMidia("x".repeat(80))?.length).toBe(40);
  });

  it("lista as pastas de primeiro nível (vazias também) com quantas fotos cada uma tem", () => {
    raiz = mkdtempSync(path.join(os.tmpdir(), "midias-"));
    criarPastaMidia(raiz, "perfil");
    criarPastaMidia(raiz, "stories");
    criarPastaMidia(raiz, "vazia");
    mkdirSync(path.join(raiz, ".oculta"));
    salvarMidia(path.join(raiz, "perfil"), "a.jpg", JPG);
    salvarMidia(path.join(raiz, "stories"), "b.jpg", JPG);
    salvarMidia(path.join(raiz, "stories"), "b.jpg", JPG);
    writeFileSync(path.join(raiz, "solta.jpg"), JPG);
    expect(listarMidias(raiz).map((m) => m.path)).toEqual(["perfil/a.jpg", "solta.jpg", "stories/b-2.jpg", "stories/b.jpg"]);
    expect(pastasDeMidia(raiz)).toEqual([
      { nome: "perfil", fotos: 1 },
      { nome: "stories", fotos: 2 },
      { nome: "vazia", fotos: 0 },
    ]);
  });

  it("criar pasta que já existe não é erro; nome que escapa da raiz é recusado", () => {
    raiz = mkdtempSync(path.join(os.tmpdir(), "midias-"));
    criarPastaMidia(raiz, "stories");
    criarPastaMidia(raiz, "stories");
    expect(existsSync(path.join(raiz, "stories"))).toBe(true);
    expect(() => criarPastaMidia(raiz, "../fora")).toThrow("inválido");
    expect(() => criarPastaMidia(raiz, "a/b")).toThrow("inválido");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// O adb de verdade não roda aqui: `rodar` devolve o que o uiautomator e o cat devolveriam e conta as chamadas.
const chamadas: string[] = [];
vi.mock("../agente-vps/lib/processo.mjs", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    rodar: async (_adb: string, args: string[]) => {
      const comando = args.slice(3).join(" ");
      chamadas.push(comando);
      if (comando.startsWith("uiautomator dump")) return { codigo: 0, stdout: "UI hierchary dumped to: /sdcard/sm_ui.xml", stderr: "" };
      if (comando.startsWith("cat ")) {
        return { codigo: 0, stdout: `<hierarchy><node text="tela ${chamadas.filter((c) => c.startsWith("uiautomator")).length}" bounds="[0,0][100,100]" /></hierarchy>`, stderr: "" };
      }
      if (comando.startsWith("settings get")) return { codigo: 0, stdout: "com.android.adbkeyboard/.AdbIME\n", stderr: "" };
      if (comando.startsWith("am broadcast")) return { codigo: 0, stdout: "Broadcast completed: result=0", stderr: "" };
      return { codigo: 0, stdout: "", stderr: "" };
    },
  };
});

import { Dispositivo } from "../agente-vps/lib/adb.mjs";

const dumps = () => chamadas.filter((c) => c.startsWith("uiautomator dump")).length;

describe("Cache do dump por tela (Dispositivo.telaAtual)", () => {
  beforeEach(() => {
    chamadas.length = 0;
  });

  it("depois de um dump, telaAtual não lê de novo enquanto nada muda a tela", async () => {
    const d = new Dispositivo("adb", "127.0.0.1:6000");
    expect((await d.tela())[0].texto).toBe("tela 1");
    expect((await d.telaAtual())[0].texto).toBe("tela 1");
    expect((await d.telaAtual())[0].texto).toBe("tela 1");
    expect(dumps()).toBe(1);
    // Só leitura (teclado, foco, props) não invalida.
    await d.shell("dumpsys", "input_method");
    await d.focoAtual();
    await d.prop("ro.build.version.release");
    await d.telaAtual();
    expect(dumps()).toBe(1);
  });

  it("toque, tecla, texto, apagar, arrastar e abrir/fechar app invalidam: a próxima leitura é um dump novo", async () => {
    const d = new Dispositivo("adb", "127.0.0.1:6000");
    const acoes: Array<[string, () => Promise<unknown>]> = [
      ["tocar", () => d.tocar(10, 20)],
      ["tecla", () => d.tecla("KEYCODE_BACK")],
      ["digitar", () => d.digitar("Promoção 🔥")],
      ["limparCampo", () => d.limparCampo(3)],
      ["arrastar", () => d.arrastar(1, 2, 3, 4)],
      ["fecharApp", () => d.fecharApp("com.instagram.android")],
    ];
    let esperado = 0;
    for (const [nome, acao] of acoes) {
      await d.telaAtual();
      esperado += 1;
      expect(dumps(), `antes de ${nome}`).toBe(esperado);
      await d.telaAtual();
      expect(dumps(), `cache antes de ${nome}`).toBe(esperado);
      await acao();
    }
    await d.telaAtual();
    expect(dumps()).toBe(esperado + 1);
  });

  it("tela() sempre lê de novo e renova o que fica guardado", async () => {
    const d = new Dispositivo("adb", "127.0.0.1:6000");
    await d.tela();
    expect((await d.tela())[0].texto).toBe("tela 2");
    expect((await d.telaAtual())[0].texto).toBe("tela 2");
    expect(dumps()).toBe(2);
  });

  it("o texto com acento e emoji sai pelo broadcast do teclado ADB (uma chamada, sem input text)", async () => {
    const d = new Dispositivo("adb", "127.0.0.1:6000");
    expect(await d.digitar("Olá 😀")).toBe("broadcast");
    expect(chamadas).toEqual(["settings get secure default_input_method", "am broadcast -a ADB_INPUT_TEXT --es msg 'Olá 😀'"]);
  });
});

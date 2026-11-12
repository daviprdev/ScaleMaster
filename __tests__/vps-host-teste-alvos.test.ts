import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AVISO_HOST_TESTE, bloqueioPorRam, decidirRam, parseCapacidade } from "../lib/vps/jobs";
import { errosPorCampo, expandirEtapas, parseAlvos, parseEstrutura, resultadoPorAlvo, resumoDosAlvos } from "../lib/vps/estruturacao";
import { CONEXAO_OUTRA_CONTA, conferirConexao, motivoParaPular } from "../agente-vps/lib/estrutura.mjs";

const RAIZ = path.join(__dirname, "..");

describe("Host de teste: bloqueio de RAM vira aviso", () => {
  it("sem HOST_TESTE bloqueia; com ele o envio passa com aviso amarelo, o número e o texto", () => {
    const bloqueio = bloqueioPorRam(1452, 1);
    expect(decidirRam(bloqueio, false)).toEqual({ bloqueio: "RAM insuficiente: 1452 MB livres para 1 conta", aviso: null });
    expect(decidirRam(bloqueio, true)).toEqual({ bloqueio: null, aviso: "RAM insuficiente: 1452 MB livres para 1 conta · host de teste: envio liberado" });
    expect(AVISO_HOST_TESTE).toBe("host de teste: envio liberado");
    // RAM suficiente: nada a avisar nos dois casos.
    expect(decidirRam(bloqueioPorRam(4000, 1), true)).toEqual({ bloqueio: null, aviso: null });
  });

  it("o agente manda hostTeste em capacity; só true liga o modo", () => {
    expect(parseCapacidade({ maxLigadas: 1, hostTeste: true }).hostTeste).toBe(true);
    expect(parseCapacidade({ maxLigadas: 1, hostTeste: "1" }).hostTeste).toBe(false);
    expect(parseCapacidade({ maxLigadas: 1 }).hostTeste).toBe(false);
  });
});

describe("Diálogo Estruturar: erro por campo", () => {
  const BASE = {
    fotoPerfil: "perfil/a.jpg",
    fotoStory: "s.png",
    bio: "ok",
    perfil: "@link.zada",
    nomeDestaque: "AQUI 🔗👆",
    linkStory: "https://exemplo.com",
    legendaSticker: "",
    legendaDestaque: "",
    agendarHoras: "0",
  };
  const MIDIAS = ["perfil/a.jpg", "s.png"];

  it("perfil vazio, foto ausente e bio acima de 150 dão cada um a sua mensagem, todos de uma vez", () => {
    const erros = errosPorCampo({ ...BASE, perfil: "", fotoPerfil: "", fotoStory: "sumiu.png", bio: "x".repeat(151) }, MIDIAS);
    expect(erros).toEqual({
      fotoStory: 'A foto do story "sumiu.png" não está em /opt/scalemaster/midias.',
      bio: "A bio passa de 150 caracteres (151).",
      perfil: "Informe o perfil com o destaque.",
    });
  });

  it("formulário certo e Agendar em 0: sem erros, roda agora", () => {
    expect(errosPorCampo(BASE, MIDIAS)).toEqual({});
    const ok = parseEstrutura(BASE, MIDIAS);
    expect("value" in ok && ok.value.agendarHoras).toBe(0);
  });
});

describe("Resultado por alvo e resumo do job", () => {
  const alvos = parseAlvos("@um | A | https://a.com\n@dois | B | https://b.com\n@tres | C | https://c.com").alvos;
  const plano = expandirEtapas({ alvos, bio: "", fazerPerfil: false, fazerOauth: true, fazerStory: false });
  const feito = (key: string, message: string | null = null) => ({ key, status: "done", message });
  const erro = (key: string, message: string) => ({ key, status: "error", message });

  it("confirmar-N com @ diferente: alvo vermelho com CONEXAO_OUTRA_CONTA, os outros seguem", () => {
    const outra = conferirConexao("outra.conta", "minha.conta");
    expect(outra.ok).toBe(false);
    // A falha do confirmar-2 não bloqueia nenhuma etapa do alvo 3.
    for (const tipo of ["perfil", "destaque", "link", "conectar", "consentir", "confirmar"]) expect(motivoParaPular(`${tipo}-3`, new Set(["confirmar-2"]))).toBeNull();
    const steps = [
      feito("profissional"),
      ...["perfil-1", "destaque-1", "link-1", "conectar-1", "consentir-1"].map((k) => feito(k)),
      feito("confirmar-1", "conectada como @minha.conta"),
      ...["perfil-2", "destaque-2", "link-2", "conectar-2", "consentir-2"].map((k) => feito(k)),
      erro("confirmar-2", outra.mensagem),
      feito("perfil-3"),
      erro("destaque-3", 'não apareceu o destaque "C" em 15 s'),
      erro("link-3", "pulada: destaque-3 falhou"),
      erro("conectar-3", "pulada: destaque-3 falhou"),
      erro("consentir-3", "pulada: destaque-3 falhou"),
      erro("confirmar-3", "pulada: destaque-3 falhou"),
    ];
    const r = resultadoPorAlvo(plano, steps);
    expect(r.map((a) => [a.n, a.perfil, a.resultado])).toEqual([
      [1, "um", "conectado"],
      [2, "dois", "falhou"],
      [3, "tres", "falhou"],
    ]);
    expect(r[1].mensagem).toBe(`${CONEXAO_OUTRA_CONTA}: a página conectou @outra.conta, a conta é @minha.conta`);
    expect(r[1].etapaComFalha).toBe("confirmar-2");
    // Um print por tentativa: as 6 etapas do alvo 2 rodaram; no alvo 3 só as que rodaram de verdade (as puladas não têm print).
    expect(r[1].tentativas).toEqual(["perfil-2", "destaque-2", "link-2", "conectar-2", "consentir-2", "confirmar-2"]);
    expect(r[2].tentativas).toEqual(["perfil-3", "destaque-3"]);
    expect(r[0].destaque).toBe("A");
    expect(resumoDosAlvos(r)).toBe("1 de 3 alvos conectados");
  });

  it("profissional falhou: alvos pulados; sem andamento: pendentes; resumo no singular", () => {
    const pulados = resultadoPorAlvo(plano, plano.filter((p) => /-\d+$/.test(p.key)).map((p) => erro(p.key, "PROFISSIONAL_FALHOU: etapas de OAuth bloqueadas")));
    expect(pulados.map((a) => a.resultado)).toEqual(["pulado", "pulado", "pulado"]);
    expect(pulados[0].tentativas).toEqual([]);
    expect(resultadoPorAlvo(plano, []).map((a) => a.resultado)).toEqual(["pendente", "pendente", "pendente"]);
    expect(resultadoPorAlvo(plano, [{ key: "perfil-1", status: "running" }])[0].resultado).toBe("rodando");
    const um = expandirEtapas({ alvos: alvos.slice(0, 1), bio: "", fazerPerfil: false, fazerOauth: true, fazerStory: false });
    expect(resumoDosAlvos(resultadoPorAlvo(um, [feito("confirmar-1")]))).toBe("1 de 1 alvo conectado");
    expect(resumoDosAlvos([])).toBeNull();
  });
});

describe("Migração: exportar.sh e importar.sh", () => {
  const posix = (p: string) => p.replace(/\\/g, "/");
  let temBash = false;
  let dir = "";
  const lf = (s: string) => s.replace(/\r\n/g, "\n");

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "sm-migra-"));
    const sonda = path.join(dir, "sonda.sh");
    writeFileSync(sonda, "#!/usr/bin/env bash\necho SONDA_OK\n");
    const r = spawnSync("bash", [posix(sonda)], { encoding: "utf8" });
    temBash = r.status === 0 && /SONDA_OK/.test(r.stdout ?? "");
    const bin = path.join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      path.join(bin, "docker"),
      lf(`#!/usr/bin/env bash
case "$1 $2" in
  "ps --filter") [ "$LIGADO" = 1 ] && echo ig-7; exit 0 ;;
  "volume ls") printf "scalemaster-base\\nscalemaster-ig-5\\nscalemaster-ig-7\\n" ;;
esac
exit 0
`)
    );
  });

  const rodar = (script: string, args: string[], env: Record<string, string> = {}) =>
    spawnSync("bash", [posix(path.join(RAIZ, "scripts", "vps", script)), ...args], {
      encoding: "utf8",
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path")),
        PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
        SCALEMASTER_RAIZ: "/opt/scalemaster",
        SCALEMASTER_ARCH: "x86_64",
        ...env,
      } as unknown as NodeJS.ProcessEnv,
    });

  it("exportar --simular: docker save das imagens, um tar por volume, estado, agente, sistema e MANIFESTO", () => {
    if (!temBash) return;
    const r = rodar("exportar.sh", ["/tmp/migra", "--simular"]);
    const saida = `${r.stdout}${r.stderr}`;
    expect(r.status, saida).toBe(0);
    expect(saida).toContain("+ docker save -o /tmp/migra/imagens.tar redroid/redroid:13.0.0-latest scalemaster-redsocks:1 alpine:3.20");
    for (const v of ["scalemaster-base", "scalemaster-ig-5", "scalemaster-ig-7"]) {
      expect(saida).toContain(`+ docker run --rm -v ${v}:/de:ro -v /tmp/migra/volumes:/para alpine:3.20 tar -czf /para/${v}.tgz -C /de .`);
    }
    expect(saida).toMatch(/\+ tar -czf \/tmp\/migra\/dados\.tgz -C \/ --exclude=opt\/scalemaster\/vps\/prints opt\/scalemaster\/vps opt\/scalemaster\/apks/);
    expect(saida).toContain("+ tar -czf /tmp/migra/agente.tgz -C /opt/scalemaster/agente-vps --ignore-failed-read .env config.json");
    expect(saida).toContain("+ cp -p /etc/systemd/system/scalemaster-vps-agent.service /tmp/migra/sistema/etc_systemd_system_scalemaster-vps-agent.service");
    expect(saida).toMatch(/MANIFESTO: arch=x86_64/);
  }, 30_000);

  it("exportar recusa com container de conta ligado", () => {
    if (!temBash) return;
    const r = rodar("exportar.sh", ["/tmp/migra", "--simular"], { LIGADO: "1" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Containers de conta ligados: ig-7/);
  }, 30_000);

  it("importar: para em arquitetura diferente; na mesma, docker load antes dos volumes e o agente por último", () => {
    if (!temBash) return;
    const pasta = path.join(dir, "export");
    mkdirSync(path.join(pasta, "volumes"), { recursive: true });
    writeFileSync(path.join(pasta, "MANIFESTO"), "arch=arm64\nimagens=redroid\n");
    const outra = rodar("importar.sh", [posix(pasta), "--simular"]);
    expect(outra.status).not.toBe(0);
    expect(`${outra.stdout}${outra.stderr}`).toMatch(/A exportação é de arm64 e este host é x86_64/);

    writeFileSync(path.join(pasta, "MANIFESTO"), "arch=x86_64\nimagens=redroid scalemaster-redsocks:1 alpine:3.20\n");
    writeFileSync(path.join(pasta, "volumes", "scalemaster-ig-5.tgz"), "x");
    const r = rodar("importar.sh", [posix(pasta), "--simular"]);
    const saida = `${r.stdout}${r.stderr}`;
    expect(r.status, saida).toBe(0);
    const pos = (t: string) => saida.indexOf(t);
    expect(pos("+ docker load -i")).toBeGreaterThan(-1);
    expect(pos("+ docker volume create --label scalemaster.vps=1 scalemaster-ig-5")).toBeGreaterThan(pos("+ docker load -i"));
    expect(pos("+ tar -xzf")).toBeGreaterThan(pos("+ docker volume create"));
    expect(saida).toContain("+ cp " + posix(pasta) + "/sistema/etc_modules-load.d_redroid.conf /etc/modules-load.d/redroid.conf");
    expect(pos("+ systemctl enable --now scalemaster-vps-agent")).toBeGreaterThan(pos("+ tar -xzf"));
  }, 30_000);
});

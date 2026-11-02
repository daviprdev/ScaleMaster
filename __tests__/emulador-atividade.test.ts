import { describe, it, expect } from "vitest";
import {
  ATIVIDADE_FLUXO,
  atividadeSteps,
  erroDaMidia,
  extensaoDoTipo,
  midiaPaths,
  parseAcoes,
  parseAtividadeInput,
  parseStoryDados,
} from "../lib/emulador/atividade";
import { busyInstances, canEditJob, linkedJobs, type EmulatorJob } from "../lib/emulador/jobs";

const USER = "11111111-2222-4333-8444-555555555555";
const FOTO = `emulador/${USER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg`;
const VIDEO = `emulador/${USER}/aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff.mp4`;
const STORY = { link: "meusite.com/oferta?x=1", texto: "Clique aqui", destaque: "Links" };

describe("atividade: o que marcar e as etapas", () => {
  it("ações válidas, sem repetir, na ordem da lista", () => {
    expect(parseAcoes(["story", "aquecer", "story", "voar", 3])).toEqual(["aquecer", "story"]);
    expect(parseAcoes("aquecer")).toEqual([]);
  });

  it("etapas: ligar, proxy e Instagram sempre; o resto só com a ação marcada", () => {
    expect(atividadeSteps(["aquecer"]).map((s) => s.key)).toEqual(["abrir", "proxy", "instagram", "seguir", "reels", "fechar"]);
    expect(atividadeSteps(["foto", "story"]).map((s) => s.key)).toEqual(["abrir", "proxy", "instagram", "foto", "story", "destaque", "fechar"]);
    expect(atividadeSteps(["aquecer", "foto", "story"])).toHaveLength(ATIVIDADE_FLUXO.length);
  });
});

describe("atividade: mídias", () => {
  it("foto só JPG/PNG; story aceita vídeo; limites de tamanho", () => {
    expect(erroDaMidia("foto", "image/jpg", 1000)).toBeNull();
    expect(erroDaMidia("foto", "video/mp4", 1000)).toMatch(/JPG ou PNG/);
    expect(erroDaMidia("story", "video/quicktime", 50 * 1024 * 1024)).toBeNull();
    expect(erroDaMidia("story", "image/png", 9 * 1024 * 1024)).toMatch(/Máximo: 8 MB/);
    expect(erroDaMidia("story", "video/mp4", 0)).toBe("Arquivo vazio.");
  });

  it("extensão sai do tipo", () => {
    expect(extensaoDoTipo("image/jpg")).toBe(".jpg");
    expect(extensaoDoTipo("image/png")).toBe(".png");
    expect(extensaoDoTipo("video/quicktime")).toBe(".mov");
  });
});

describe("atividade: link e textos do story", () => {
  it("link sem https ganha https; texto do sticker é opcional", () => {
    const r = parseStoryDados({ ...STORY, texto: "" });
    expect(r).toEqual({ value: { link: "https://meusite.com/oferta?x=1", texto: "", destaque: "Links" } });
  });

  it("recusa acento, emoji, link quebrado e destaque comprido", () => {
    expect(parseStoryDados({ ...STORY, texto: "Promoção" })).toHaveProperty("error");
    expect(parseStoryDados({ ...STORY, texto: "Oi 🔥" })).toHaveProperty("error");
    expect(parseStoryDados({ ...STORY, link: "não é link" })).toHaveProperty("error");
    expect(parseStoryDados({ ...STORY, link: "ftp://x.com" })).toHaveProperty("error");
    expect(parseStoryDados({ ...STORY, destaque: "1234567890123456" })).toHaveProperty("error");
    expect(parseStoryDados({ ...STORY, destaque: " " })).toHaveProperty("error");
  });
});

describe("atividade: corpo do POST", () => {
  it("aquecer sozinho não pede mídia nem link", () => {
    expect(parseAtividadeInput({ acoes: ["aquecer"] }, USER)).toEqual({ value: { acoes: ["aquecer"], midias: {}, story: null } });
  });

  it("foto e story exigem mídia do próprio usuário, com a extensão certa", () => {
    const outro = FOTO.replace(USER, "99999999-2222-4333-8444-555555555555");
    expect(parseAtividadeInput({ acoes: ["foto"], midias: { foto: outro } }, USER)).toEqual({ error: "Escolha a foto de perfil." });
    expect(parseAtividadeInput({ acoes: ["foto"], midias: { foto: VIDEO } }, USER)).toEqual({ error: "Escolha a foto de perfil." });
    expect(parseAtividadeInput({ acoes: ["story"], midias: {}, story: STORY }, USER)).toEqual({ error: "Escolha a mídia do story." });
    expect(parseAtividadeInput({ acoes: ["story"], midias: { story: "../x.mp4" }, story: STORY }, USER)).toEqual({ error: "Escolha a mídia do story." });
  });

  it("tudo marcado: guarda só o que foi pedido", () => {
    const r = parseAtividadeInput({ acoes: ["aquecer", "foto", "story"], midias: { foto: FOTO, story: VIDEO, extra: "x" }, story: STORY }, USER);
    expect(r).toEqual({
      value: {
        acoes: ["aquecer", "foto", "story"],
        midias: { foto: FOTO, story: VIDEO },
        story: { link: "https://meusite.com/oferta?x=1", texto: "Clique aqui", destaque: "Links" },
      },
    });
    if ("value" in r) expect(midiaPaths(r.value)).toEqual([FOTO, VIDEO]);
  });

  it("nada marcado é erro", () => {
    expect(parseAtividadeInput({ acoes: [] }, USER)).toHaveProperty("error");
  });
});

describe("atividade na fila", () => {
  const job = (over: Partial<EmulatorJob>): EmulatorJob => ({
    id: "11111111-1111-4111-8111-111111111111",
    agentId: "pc",
    kind: "nova-conta",
    acoes: [],
    label: "samantapoli_ana485",
    templateIndex: 0,
    instanceIndex: 2,
    steps: [{ key: "nome", status: "done", message: "samantapoli_ana485" }],
    status: "done",
    error: null,
    prompt: null,
    createdAt: "2026-11-01T18:00:00Z",
    updatedAt: "2026-11-01T18:13:00Z",
    ...over,
  });
  const inst = [{ index: 2, name: "samantapoli_ana485" }];

  it("atividade mais nova não tira a conta da instância (Editar dados, aviso)", () => {
    const atividade = job({ id: "22222222-2222-4222-8222-222222222222", kind: "atividade", acoes: ["aquecer"], steps: [], status: "running" });
    expect(linkedJobs([atividade, job({})], "pc", inst).get(2)?.kind).toBe("nova-conta");
  });

  it("instância ocupada por conta ou atividade na fila/rodando", () => {
    const jobs = [
      job({ kind: "atividade", status: "queued", instanceIndex: 2 }),
      job({ status: "running", instanceIndex: 3 }),
      job({ status: "error", instanceIndex: 4 }),
      job({ agentId: "outro", status: "queued", instanceIndex: 5 }),
    ];
    expect([...busyInstances(jobs, "pc")].sort()).toEqual([2, 3]);
  });

  it("atividade não tem Editar dados", () => {
    expect(canEditJob(job({ kind: "atividade", status: "error" }))).toBe(false);
    expect(canEditJob(job({ status: "error" }))).toBe(true);
  });
});

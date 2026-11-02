import { describe, it, expect } from "vitest";
import {
  ATIVIDADE_FLUXO,
  atividadeSteps,
  parseAcoes,
  parseAtividadeInput,
  parseMarcadas,
  parseStoryDados,
  type MediaFile,
} from "../lib/emulador/atividade";
import { NOVA_CONTA_FLUXO, busyInstances, canEditJob, linkedJobs, type EmulatorJob } from "../lib/emulador/jobs";
import { parseMedia } from "../lib/emulador/payload";

const FOTO = "Camera/PERFIL 01.jpg";
const FOTO2 = "Camera/PERFIL 03.jpg";
const VIDEO = "Camera/CTA 01.mp4";
const FILES: MediaFile[] = [
  { path: VIDEO, size: 2_697_912, tipo: "video" },
  { path: FOTO, size: 85_617, tipo: "imagem" },
  { path: FOTO2, size: 102_589, tipo: "imagem" },
];
const STORY = { link: "meusite.com/oferta?x=1", texto: "Clique aqui", destaque: "Links" };

describe("atividade: o que marcar e as etapas", () => {
  it("ações válidas, sem repetir, na ordem da lista", () => {
    expect(parseAcoes(["story", "foto", "story", "voar", 3])).toEqual(["foto", "story"]);
    expect(parseAcoes("story")).toEqual([]);
  });

  it("etapas: ligar, proxy e Instagram sempre; o resto só com a ação marcada", () => {
    expect(atividadeSteps(["story"]).map((s) => s.key)).toEqual(["abrir", "proxy", "instagram", "story", "destaque", "fechar"]);
    expect(atividadeSteps(["foto", "story"]).map((s) => s.key)).toEqual(["abrir", "proxy", "instagram", "foto", "story", "destaque", "fechar"]);
    expect(atividadeSteps(["foto", "story"])).toHaveLength(ATIVIDADE_FLUXO.length);
  });

  it("aquecer saiu do Estruturar e foi para o fim da criação de conta", () => {
    expect(parseAcoes(["aquecer"])).toEqual([]);
    expect(NOVA_CONTA_FLUXO.slice(-4).map((s) => s.key)).toEqual(["cadastro", "seguir", "reels", "fechar"]);
  });
});

describe("atividade: mídias da pasta do MuMu", () => {
  it("lista do agente: só caminho relativo seguro, foto ou vídeo, sem repetir", () => {
    const m = parseMedia({
      root: " C:/Users/x/MuMuSharedFolder ",
      files: [
        { path: FOTO, size: 10, tipo: "imagem" },
        { path: FOTO, size: 10, tipo: "imagem" },
        { path: "../config.json", size: 1, tipo: "imagem" },
        { path: "C:/Windows/x.jpg", size: 1, tipo: "imagem" },
        { path: "/etc/x.jpg", size: 1, tipo: "imagem" },
        { path: "Download/app.apk", size: 1, tipo: "apk" },
        { path: VIDEO, size: -5, tipo: "video" },
      ],
    });
    expect(m.root).toBe("C:/Users/x/MuMuSharedFolder");
    expect(m.files).toEqual([
      { path: FOTO, size: 10, tipo: "imagem" },
      { path: VIDEO, size: 0, tipo: "video" },
    ]);
    expect(parseMedia(null)).toEqual({ root: null, files: [] });
  });

  it("marcadas: foto só imagem; story aceita vídeo; arquivo fora da lista derruba tudo", () => {
    expect(parseMarcadas([FOTO, FOTO2], "foto", FILES)).toEqual([FOTO, FOTO2]);
    expect(parseMarcadas([VIDEO], "foto", FILES)).toBeNull();
    expect(parseMarcadas([VIDEO, FOTO], "story", FILES)).toEqual([VIDEO, FOTO]);
    expect(parseMarcadas([FOTO, "Camera/outra.jpg"], "foto", FILES)).toBeNull();
    expect(parseMarcadas([], "foto", FILES)).toBeNull();
    expect(parseMarcadas(FOTO, "foto", FILES)).toBeNull();
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
  it("aquecer não é mais ação do Estruturar", () => {
    expect(parseAtividadeInput({ acoes: ["aquecer"] }, FILES)).toHaveProperty("error");
  });

  it("foto e story exigem arquivo da pasta do MuMu, do tipo certo", () => {
    expect(parseAtividadeInput({ acoes: ["foto"], midias: { foto: [VIDEO] } }, FILES)).toHaveProperty("error");
    expect(parseAtividadeInput({ acoes: ["foto"], midias: {} }, FILES)).toHaveProperty("error");
    expect(parseAtividadeInput({ acoes: ["story"], midias: {}, story: STORY }, FILES)).toHaveProperty("error");
    expect(parseAtividadeInput({ acoes: ["story"], midias: { story: ["../x.mp4"] }, story: STORY }, FILES)).toHaveProperty("error");
  });

  it("tudo marcado: guarda só o que foi pedido", () => {
    const r = parseAtividadeInput(
      { acoes: ["foto", "story"], midias: { foto: [FOTO, FOTO2], story: [VIDEO], extra: ["x"] }, story: STORY },
      FILES
    );
    expect(r).toEqual({
      value: {
        acoes: ["foto", "story"],
        midias: { foto: [FOTO, FOTO2], story: [VIDEO] },
        story: { link: "https://meusite.com/oferta?x=1", texto: "Clique aqui", destaque: "Links" },
      },
    });
  });

  it("nada marcado é erro", () => {
    expect(parseAtividadeInput({ acoes: [] }, FILES)).toHaveProperty("error");
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
    const atividade = job({ id: "22222222-2222-4222-8222-222222222222", kind: "atividade", acoes: ["story"], steps: [], status: "running" });
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

import { describe, expect, it } from "vitest";
import { summarizePublishCheck } from "../lib/meta-publish-check";

describe("summarizePublishCheck", () => {
  it("cota respondida = publicação liberada", () => {
    const r = summarizePublishCheck({
      accountType: { account_type: "MEDIA_CREATOR" },
      limit: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] },
    });
    expect(r.can_publish).toBe(true);
    expect(r.summary).toBe("Publicação liberada pela Meta · conta media_creator · 3/100 posts nas últimas 24 h.");
  });
  it("conta pessoal: diz o que a Meta informou", () => {
    const r = summarizePublishCheck({
      accountType: { account_type: "PERSONAL" },
      limit: { error: { message: "Unsupported get request.", code: 100 } },
    });
    expect(r.can_publish).toBe(false);
    expect(r.summary).toContain("conta é pessoal");
  });
  it("profissional sem cota: mostra a resposta exata da Meta, sem dizer que caiu", () => {
    const r = summarizePublishCheck({
      accountType: { account_type: "BUSINESS" },
      limit: { error: { message: "Application does not have permission for this action", code: 10 } },
    });
    expect(r.can_publish).toBe(false);
    expect(r.meta_error).toBe("Application does not have permission for this action (code 10)");
    expect(r.summary).toContain("resposta: Application does not have permission for this action (code 10)");
    expect(r.summary).not.toMatch(/ca[ií]u|ca[ií]da/i);
  });
  it("sem resposta nenhuma", () => {
    const r = summarizePublishCheck({ accountType: null, limit: null });
    expect(r.can_publish).toBe(false);
    expect(r.summary).toContain("tipo não informado");
  });
});

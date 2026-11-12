import { describe, expect, it } from "vitest";
import { moverEstruturadas } from "../lib/vps/mover-ao-concluir";
import { expandirEtapas } from "../lib/vps/estruturacao";

/** Supabase de mentira: só as chamadas que moverEstruturadas usa. */
function falso(linhas: Array<Record<string, unknown>>) {
  const updates: Array<{ valores: Record<string, unknown>; filtros: Record<string, unknown> }> = [];
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    in: () => consulta,
    not: () => consulta,
    limit: async () => ({ data: linhas, error: null }),
  };
  const admin = {
    from: () => ({
      ...consulta,
      update: (valores: Record<string, unknown>) => {
        const filtros: Record<string, unknown> = {};
        const cadeia = {
          eq: (k: string, v: unknown) => {
            filtros[k] = v;
            return Object.assign(Promise.resolve({ error: null }), cadeia);
          },
        };
        updates.push({ valores, filtros });
        return cadeia;
      },
    }),
  };
  return { admin: admin as never, updates };
}

describe("Ao concluir, mover para a pasta", () => {
  const plano = expandirEtapas({ alvos: [{ perfil: "link.zada", destaque: "AQUI", link: "" }], bio: "", fazerPerfil: true, fazerOauth: true, fazerStory: true });
  const passos = (falha?: string) => plano.map((p) => ({ key: p.key, status: p.key === falha ? "error" : "done", message: p.key === falha ? "x" : null }));

  it("conectada (pronta ou só o destaque falhou) move a conta e limpa o destino; sem conectar fica esperando", async () => {
    const { admin, updates } = falso([
      { id: "e1", user_id: "u", conta_id: "c1", status: "done", acoes: plano, steps: passos(), pasta: "PRONTAS" },
      { id: "e2", user_id: "u", conta_id: "c2", status: "error", acoes: plano, steps: passos("destacar"), pasta: "PRONTAS" },
      { id: "e3", user_id: "u", conta_id: "c3", status: "error", acoes: plano, steps: passos("link-1"), pasta: "PRONTAS" },
    ]);
    expect(await moverEstruturadas(admin, "agente")).toBe(2);
    expect(updates.map((u) => [u.valores.pasta, u.filtros.id])).toEqual([
      ["PRONTAS", "c1"],
      [null, "e1"],
      ["PRONTAS", "c2"],
      [null, "e2"],
    ]);
  });
});

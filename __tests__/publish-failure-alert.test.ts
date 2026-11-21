import { describe, expect, it } from "vitest";
import { buildPublishFailureAlert } from "../lib/publish-failure-alert";
import { isAccountDeadError } from "../lib/account-health";

describe("buildPublishFailureAlert", () => {
  it("sem falhas, sem aviso", () => {
    expect(buildPublishFailureAlert([])).toBeNull();
  });
  it("mostra o erro exato da Meta e as contas, sem afirmar conta caída", () => {
    const rows = ["a", "b", "c", "d", "e"].map((u) => ({ error_message: "Unsupported request - method type: post", username: u }));
    const alert = buildPublishFailureAlert(rows)!;
    expect(alert.title).toBe("⚠️ 5 postagens falharam");
    expect(alert.body).toContain('"Unsupported request - method type: post"');
    expect(alert.body).toContain("@a, @b, @c e mais 2");
    expect(alert.title + alert.body).not.toMatch(/ca[ií]da/i);
  });
  it("singular e contagem de outros erros", () => {
    expect(buildPublishFailureAlert([{ error_message: "x", username: "a" }])!.title).toBe("⚠️ 1 postagem falhou");
    const alert = buildPublishFailureAlert([
      { error_message: "x", username: "a" },
      { error_message: "x", username: "b" },
      { error_message: "y", username: "c" },
    ])!;
    expect(alert.body).toContain('"x"');
    expect(alert.body).toContain("+1 outro erro");
  });
});

describe("isAccountDeadError", () => {
  it("'Unsupported request - method type: post' não marca mais a conta como caída", () => {
    expect(isAccountDeadError("Unsupported request - method type: post")).toBe(false);
  });
  it("checkpoint e token inválido continuam marcando", () => {
    expect(isAccountDeadError("Error validating access token: checkpoint required")).toBe(true);
    expect(isAccountDeadError("Invalid OAuth access token - Cannot parse")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { allPermissions, can, homePathFor, resolvePermissions, ROLE_DEFAULTS } from "./permissions";

describe("matriz de permissões", () => {
  it("Gestor tem todas as permissões", () => {
    expect(ROLE_DEFAULTS.GESTOR).toEqual(allPermissions());
  });

  it("Supervisor: facturação completa, sem utilizadores/equipas/auditoria nem edição de preços", () => {
    const p = ROLE_DEFAULTS.SUPERVISOR;
    expect(can(p, "billing_generators", "close")).toBe(true);
    expect(can(p, "billing_providers", "export")).toBe(true);
    expect(can(p, "reports", "export")).toBe(true);
    expect(can(p, "providers", "view")).toBe(true);
    expect(can(p, "prices_targets", "view")).toBe(true);
    expect(can(p, "prices_targets", "edit")).toBe(false);
    expect(can(p, "providers", "create")).toBe(false);
    expect(can(p, "users", "view")).toBe(false);
    expect(can(p, "teams", "view")).toBe(false);
    expect(can(p, "audit", "view")).toBe(false);
  });

  it("Técnico: ver/criar/editar facturação e importar geradores", () => {
    const p = ROLE_DEFAULTS.TECNICO;
    expect(can(p, "dashboard", "view")).toBe(true);
    expect(can(p, "billing_providers", "create")).toBe(true);
    expect(can(p, "billing_generators", "import")).toBe(true);
    expect(can(p, "billing_providers", "import")).toBe(false);
    expect(can(p, "billing_providers", "delete")).toBe(false);
    expect(can(p, "billing_generators", "validate")).toBe(false);
    expect(can(p, "billing_providers", "export")).toBe(false);
    expect(can(p, "reports", "view")).toBe(false);
    expect(can(p, "providers", "view")).toBe(false);
  });
});

describe("resolvePermissions", () => {
  it("override negar remove a permissão do default", () => {
    const p = resolvePermissions("SUPERVISOR", [{ module: "billing_providers", action: "export", allowed: false }]);
    expect(can(p, "billing_providers", "export")).toBe(false);
    expect(can(p, "billing_generators", "export")).toBe(true);
  });

  it("override permitir acrescenta a permissão", () => {
    const p = resolvePermissions("TECNICO", [{ module: "reports", action: "view", allowed: true }]);
    expect(can(p, "reports", "view")).toBe(true);
  });

  it("ignora overrides fora do catálogo", () => {
    const p = resolvePermissions("TECNICO", [{ module: "x", action: "y", allowed: true }]);
    expect(p).toEqual(ROLE_DEFAULTS.TECNICO);
  });
});

describe("homePathFor", () => {
  it("página inicial por perfil", () => {
    expect(homePathFor("GESTOR")).toBe("/dashboard");
    expect(homePathFor("SUPERVISOR")).toBe("/dashboard");
    expect(homePathFor("TECNICO")).toBe("/meu-trabalho");
  });
});

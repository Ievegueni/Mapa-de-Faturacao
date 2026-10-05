/** Catálogo de permissões e matriz por perfil (CLAUDE.md §5.2). */

export type Role = "GESTOR" | "SUPERVISOR" | "TECNICO";
export type BillingType = "PROVIDERS" | "GERADORES";

export const ROLES: Role[] = ["GESTOR", "SUPERVISOR", "TECNICO"];
export const BILLING_TYPES: BillingType[] = ["PROVIDERS", "GERADORES"];

export const MODULES = {
  dashboard: ["view"],
  providers: ["view", "create", "edit", "delete"],
  prices_targets: ["view", "edit"],
  billing_providers: ["view", "create", "edit", "delete", "validate", "export"],
  billing_generators: ["view", "create", "edit", "delete", "import", "validate", "close", "export"],
  reports: ["view", "export"],
  users: ["view", "create", "edit", "delete"],
  teams: ["view", "create", "edit", "delete"],
  audit: ["view"],
} as const;

export type Module = keyof typeof MODULES;
export type Action = (typeof MODULES)[Module][number];
/** Chave `module.action`, ex.: `billing_providers.export`. */
export type PermissionKey = string;

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  providers: "Parceiros",
  prices_targets: "Preços, faixas e targets (Geradores)",
  billing_providers: "Rede Residencial — facturas",
  billing_generators: "Combustível e Geradores — mapas",
  reports: "Relatórios",
  users: "Utilizadores",
  teams: "Equipas",
  audit: "Auditoria",
};

export const ACTION_LABELS: Record<string, string> = {
  view: "Ver",
  create: "Criar",
  edit: "Editar",
  delete: "Eliminar",
  import: "Importar",
  validate: "Validar",
  close: "Fechar",
  export: "Exportar",
};

export const ROLE_LABELS: Record<Role, string> = {
  GESTOR: "Gestor",
  SUPERVISOR: "Supervisor",
  TECNICO: "Técnico",
};

/** Os dois módulos da plataforma (o tipo PROVIDERS é a Rede Residencial). */
export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  PROVIDERS: "Rede Residencial",
  GERADORES: "Combustível e Geradores",
};

/** Prefixo das rotas de cada módulo na web. */
export const MODULE_BASE: Record<BillingType, string> = {
  PROVIDERS: "/residencial",
  GERADORES: "/geradores",
};

export function permissionKey(module: string, action: string): PermissionKey {
  return `${module}.${action}`;
}

export function isValidPermission(module: string, action: string): boolean {
  const actions = (MODULES as Record<string, readonly string[]>)[module];
  return !!actions && actions.includes(action);
}

/** Todas as permissões do catálogo, pela ordem da matriz. */
export function allPermissions(): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const [module, actions] of Object.entries(MODULES)) {
    for (const action of actions) keys.push(permissionKey(module, action));
  }
  return keys;
}

const BILLING = ["billing_providers", "billing_generators"] as const;

function buildDefaults(): Record<Role, PermissionKey[]> {
  const supervisor: PermissionKey[] = [
    "dashboard.view",
    "providers.view",
    "prices_targets.view",
    "reports.view",
    "reports.export",
  ];
  const tecnico: PermissionKey[] = ["dashboard.view", "billing_generators.import"];

  for (const m of BILLING) {
    for (const a of MODULES[m]) supervisor.push(permissionKey(m, a));
    for (const a of ["view", "create", "edit"]) tecnico.push(permissionKey(m, a));
  }

  const ordered = (keys: PermissionKey[]) => allPermissions().filter((k) => keys.includes(k));
  return { GESTOR: allPermissions(), SUPERVISOR: ordered(supervisor), TECNICO: ordered(tecnico) };
}

/** Permissões por omissão de cada perfil. */
export const ROLE_DEFAULTS: Record<Role, PermissionKey[]> = buildDefaults();

export interface PermissionOverride {
  module: string;
  action: string;
  allowed: boolean;
}

/** Permissão efectiva = default do perfil ± override do utilizador. */
export function resolvePermissions(role: Role, overrides: PermissionOverride[] = []): PermissionKey[] {
  const set = new Set(ROLE_DEFAULTS[role]);
  for (const o of overrides) {
    if (!isValidPermission(o.module, o.action)) continue;
    const key = permissionKey(o.module, o.action);
    if (o.allowed) set.add(key);
    else set.delete(key);
  }
  return allPermissions().filter((k) => set.has(k));
}

export function can(permissions: readonly PermissionKey[], module: string, action: string): boolean {
  return permissions.includes(permissionKey(module, action));
}

/** Página inicial por perfil (CLAUDE.md §5.4). */
export function homePathFor(role: Role): string {
  return role === "TECNICO" ? "/meu-trabalho" : "/dashboard";
}

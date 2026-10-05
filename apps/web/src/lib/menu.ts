import { BillingType, can, Role } from "@cf/shared";
import type { Me } from "./types";

export interface MenuItem {
  to: string;
  label: string;
  icon: string;
  /** Permissão necessária (`module.action`). */
  permission?: [string, string];
  roles?: Role[];
  /** Só aparece a quem tem equipas deste tipo (o Gestor tem todos). */
  billingType?: BillingType;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

/** O menu é gerado a partir das permissões efectivas (CLAUDE.md §5.3). Os módulos entram à medida dos sprints. */
const SECTIONS: MenuSection[] = [
  {
    items: [
      { to: "/meu-trabalho", label: "O meu trabalho", icon: "M4 6h16M4 12h16M4 18h10", roles: ["TECNICO"] },
      { to: "/dashboard", label: "Dashboard", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z", permission: ["dashboard", "view"], roles: ["GESTOR", "SUPERVISOR"] },
    ],
  },
  {
    title: "Facturação",
    items: [
      { to: "/facturacao/providers", label: "Providers", icon: "M7 3h10l4 4v14H3V3h4Zm0 0v6h8V3M7 14h10M7 18h6", permission: ["billing_providers", "view"], billingType: "PROVIDERS" },
      { to: "/geradores/mapas", label: "Mapas de geradores", icon: "M3 5h18v14H3V5Zm0 5h18M8 5v14", permission: ["billing_generators", "view"], billingType: "GERADORES" },
      { to: "/geradores/validacoes", label: "Resumo de validações", icon: "M4 19V5m0 14h16M8 15l3-4 3 2 4-6", permission: ["billing_generators", "view"], billingType: "GERADORES" },
      { to: "/geradores/sites", label: "Sites e geradores", icon: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z", permission: ["billing_generators", "view"], billingType: "GERADORES" },
    ],
  },
  {
    title: "Configuração",
    items: [
      { to: "/providers", label: "Providers e preços", icon: "M3 7h18M3 12h18M3 17h12M17 17l2 2 3-4", permission: ["providers", "view"] },
      { to: "/faixas-desconto", label: "Faixas de desconto", icon: "M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", permission: ["prices_targets", "view"] },
      { to: "/targets", label: "Targets", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", permission: ["prices_targets", "view"] },
    ],
  },
  {
    title: "Administração",
    items: [
      { to: "/utilizadores", label: "Utilizadores", icon: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74", permission: ["users", "view"] },
      { to: "/equipas", label: "Equipas", icon: "M3 21V8l9-5 9 5v13M9 21v-6h6v6", permission: ["teams", "view"] },
    ],
  },
];

export function buildMenu(user: Me): MenuSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (i) =>
        (!i.roles || i.roles.includes(user.role)) &&
        (!i.permission || can(user.permissions, i.permission[0], i.permission[1])) &&
        (!i.billingType || user.billingTypes.includes(i.billingType)),
    ),
  })).filter((s) => s.items.length > 0);
}

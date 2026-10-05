import { BillingType, can, MODULE_BASE, Role } from "@cf/shared";
import type { Me } from "./types";

export interface MenuItem {
  to: string;
  label: string;
  icon: string;
  /** Permissão necessária (`module.action`). */
  permission?: [string, string];
  roles?: Role[];
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

const ICON = {
  work: "M4 6h16M4 12h16M4 18h10",
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  invoices: "M7 3h10l4 4v14H3V3h4Zm0 0v6h8V3M7 14h10M7 18h6",
  maps: "M3 5h18v14H3V5Zm0 5h18M8 5v14",
  validations: "M4 19V5m0 14h16M8 15l3-4 3 2 4-6",
  sites: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  reports: "M6 2h9l5 5v15H6V2Zm9 0v5h5M9 17v-4m3 4v-7m3 7v-2",
  partners: "M3 7h18M3 12h18M3 17h12M17 17l2 2 3-4",
  bands: "M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  targets: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74",
  teams: "M3 21V8l9-5 9 5v13M9 21v-6h6v6",
};

/** Menu de cada módulo: quem trabalha num módulo nunca vê as páginas do outro. */
function moduleSections(tipo: BillingType): MenuSection[] {
  const b = MODULE_BASE[tipo];
  const top: MenuItem[] = [
    { to: `${b}/meu-trabalho`, label: "O meu trabalho", icon: ICON.work, roles: ["TECNICO"] },
    { to: `${b}/dashboard`, label: "Dashboard", icon: ICON.dashboard, permission: ["dashboard", "view"] },
  ];
  if (tipo === "PROVIDERS") {
    return [
      { items: top },
      {
        title: "Facturação",
        items: [
          { to: `${b}/facturas`, label: "Facturas", icon: ICON.invoices, permission: ["billing_providers", "view"] },
          { to: `${b}/relatorios`, label: "Relatórios", icon: ICON.reports, permission: ["reports", "view"] },
        ],
      },
      { title: "Configuração", items: [{ to: `${b}/parceiros`, label: "Parceiros e orçamentos", icon: ICON.partners, permission: ["providers", "view"] }] },
    ];
  }
  return [
    { items: top },
    {
      title: "Controlo",
      items: [
        { to: `${b}/mapas`, label: "Mapas mensais", icon: ICON.maps, permission: ["billing_generators", "view"] },
        { to: `${b}/validacoes`, label: "Resumo de validações", icon: ICON.validations, permission: ["billing_generators", "view"] },
        { to: `${b}/sites`, label: "Sites e geradores", icon: ICON.sites, permission: ["billing_generators", "view"] },
        { to: `${b}/relatorios`, label: "Relatórios", icon: ICON.reports, permission: ["reports", "view"] },
      ],
    },
    {
      title: "Configuração",
      items: [
        { to: `${b}/parceiros`, label: "Parceiros e preços", icon: ICON.partners, permission: ["providers", "view"] },
        { to: `${b}/faixas-desconto`, label: "Faixas de desconto", icon: ICON.bands, permission: ["prices_targets", "view"] },
        { to: `${b}/targets`, label: "Targets", icon: ICON.targets, permission: ["prices_targets", "view"] },
      ],
    },
  ];
}

const ADMIN: MenuSection = {
  title: "Administração",
  items: [
    { to: "/utilizadores", label: "Utilizadores", icon: ICON.users, permission: ["users", "view"] },
    { to: "/equipas", label: "Equipas", icon: ICON.teams, permission: ["teams", "view"] },
  ],
};

/** O menu é gerado a partir das permissões efectivas e do módulo actual (CLAUDE.md §5.3). */
export function buildMenu(user: Me, tipo: BillingType | null): MenuSection[] {
  const sections = [...(tipo ? moduleSections(tipo) : []), ADMIN];
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (i) => (!i.roles || i.roles.includes(user.role)) && (!i.permission || can(user.permissions, i.permission[0], i.permission[1])),
      ),
    }))
    .filter((s) => s.items.length > 0);
}

/** Primeira página do módulo a que o utilizador tem acesso (O meu trabalho / Dashboard / …). */
export function moduleHome(user: Me, tipo: BillingType): string | null {
  return buildMenu(user, tipo).flatMap((s) => s.items).find((i) => i.to.startsWith(MODULE_BASE[tipo]))?.to ?? null;
}

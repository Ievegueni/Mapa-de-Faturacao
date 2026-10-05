import { BILLING_TYPES, BillingType, MODULE_BASE } from "@cf/shared";
import { useLocation } from "react-router-dom";

const KEY = "cf:modulo";

/** Módulo pela rota: /residencial/* → Rede Residencial; /geradores/* → Combustível e Geradores. */
export function moduleFromPath(path: string): BillingType | null {
  return BILLING_TYPES.find((t) => path === MODULE_BASE[t] || path.startsWith(`${MODULE_BASE[t]}/`)) ?? null;
}

export function rememberModule(tipo: BillingType) {
  try {
    localStorage.setItem(KEY, tipo);
  } catch {
    /* sem armazenamento: usa o primeiro módulo */
  }
}

/** Último módulo usado (se o utilizador ainda tiver acesso), senão o primeiro a que tem acesso. */
export function preferredModule(allowed: BillingType[]): BillingType | null {
  let last: string | null = null;
  try {
    last = localStorage.getItem(KEY);
  } catch {
    last = null;
  }
  return allowed.find((t) => t === last) ?? allowed[0] ?? null;
}

/** Módulo actual: o da rota; fora dos módulos (ex.: Utilizadores), o último usado. */
export function useCurrentModule(allowed: BillingType[]): BillingType | null {
  const { pathname } = useLocation();
  const fromPath = moduleFromPath(pathname);
  return fromPath && allowed.includes(fromPath) ? fromPath : preferredModule(allowed);
}

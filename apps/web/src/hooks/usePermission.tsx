import { ReactNode } from "react";
import { can } from "@cf/shared";
import { useAuth } from "./useAuth";

/** O frontend só esconde menus e botões; a API valida sempre (CLAUDE.md §5.2). */
export function usePermission(module: string, action: string): boolean {
  const { user } = useAuth();
  return !!user && can(user.permissions, module, action);
}

export function Can({ module, action, children }: { module: string; action: string; children: ReactNode }) {
  return usePermission(module, action) ? <>{children}</> : null;
}

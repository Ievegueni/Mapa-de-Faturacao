import { ReactNode, useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { BillingType } from "@cf/shared";
import { moduleHome } from "../lib/menu";
import { preferredModule, rememberModule } from "../lib/module";
import { useAuth } from "../hooks/useAuth";
import { usePermission } from "../hooks/usePermission";
import { Spinner } from "./ui";

/** Exige sessão; com troca de password pendente envia para /trocar-password. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Spinner label="A iniciar sessão…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== "/trocar-password") return <Navigate to="/trocar-password" replace />;
  return <>{children}</>;
}

/** Sem permissão → página inicial do perfil. */
export function RequirePermission({ module, action, children }: { module: string; action: string; children: ReactNode }) {
  const { user } = useAuth();
  const allowed = usePermission(module, action);
  if (!allowed) return <HomeRedirect />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <HomeRedirect />;
  return <>{children}</>;
}

/** Página inicial: a primeira página acessível do último módulo usado (ou do primeiro a que tem acesso). */
export function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const tipo = preferredModule(user.billingTypes);
  const home = tipo ? moduleHome(user, tipo) : null;
  if (home) return <Navigate to={home} replace />;
  // Sem módulo (sem equipas) ou sem páginas no módulo: administração ou aviso
  return <Navigate to={user.permissions.includes("users.view") ? "/utilizadores" : "/sem-acesso"} replace />;
}

/** Entrada num módulo: sem acesso ao módulo → página inicial; com acesso, fica como último módulo usado. */
export function ModuleGate({ tipo }: { tipo: BillingType }) {
  const { user } = useAuth();
  const allowed = !!user && user.billingTypes.includes(tipo);
  useEffect(() => {
    if (allowed) rememberModule(tipo);
  }, [allowed, tipo]);
  if (!allowed) return <HomeRedirect />;
  return <Outlet />;
}

import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
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
  if (!allowed) return <Navigate to={user?.homePath || "/"} replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to={user?.homePath || "/"} replace />;
  return <>{children}</>;
}

export function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.homePath || "/login"} replace />;
}

import { lazy, ReactNode, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Alert, PageHeader, Spinner } from "./components/ui";
import { HomeRedirect, ModuleGate, RequireAuth, RequirePermission, RequireRole } from "./components/guards";
import AppLayout from "./layouts/AppLayout";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import LoginPage from "./pages/LoginPage";
import MyWorkPage from "./pages/MyWorkPage";

/** Páginas carregadas a pedido: o bundle inicial fica leve (o Recharts só vem com o dashboard). */
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const MapPage = lazy(() => import("./pages/generators/MapPage"));
const MapsPage = lazy(() => import("./pages/generators/MapsPage"));
const ValidationsPage = lazy(() => import("./pages/generators/ValidationsPage"));
const SitesPage = lazy(() => import("./pages/generators/SitesPage"));
const BillingProvidersPage = lazy(() => import("./pages/billing-providers/BillingProvidersPage"));
const ProvidersPage = lazy(() => import("./pages/ProvidersPage"));
const TargetsPage = lazy(() => import("./pages/TargetsPage"));
const DiscountRulesPage = lazy(() => import("./pages/DiscountRulesPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const TeamsPage = lazy(() => import("./pages/TeamsPage"));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage"));
const UserPermissionsPage = lazy(() => import("./pages/UserPermissionsPage"));

const perm = (module: string, action: string, page: ReactNode) => <RequirePermission module={module} action={action}>{page}</RequirePermission>;

function NoAccess() {
  return (
    <>
      <PageHeader title="Sem acesso" />
      <Alert kind="info">Ainda não pertence a nenhuma equipa activa. Peça ao Gestor para o associar a uma equipa da Rede Residencial ou de Combustível e Geradores.</Alert>
    </>
  );
}

/**
 * Dois módulos separados (CLAUDE.md §5.5): /residencial/* (Rede Residencial) e /geradores/* (Combustível e Geradores).
 * As páginas comuns recebem o módulo por `tipo` e uma `key` para não partilharem estado ao mudar de módulo.
 */
export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/trocar-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<HomeRedirect />} />

          <Route path="residencial" element={<ModuleGate tipo="PROVIDERS" />}>
            <Route index element={<HomeRedirect />} />
            <Route path="meu-trabalho" element={<RequireRole roles={["TECNICO"]}><MyWorkPage key="PROVIDERS" tipo="PROVIDERS" /></RequireRole>} />
            <Route path="dashboard" element={perm("dashboard", "view", <DashboardPage key="PROVIDERS" tipo="PROVIDERS" />)} />
            <Route path="facturas" element={perm("billing_providers", "view", <BillingProvidersPage />)} />
            <Route path="relatorios" element={perm("reports", "view", <ReportsPage key="PROVIDERS" tipo="PROVIDERS" />)} />
            <Route path="parceiros" element={perm("providers", "view", <ProvidersPage key="PROVIDERS" tipo="PROVIDERS" />)} />
          </Route>

          <Route path="geradores" element={<ModuleGate tipo="GERADORES" />}>
            <Route index element={<HomeRedirect />} />
            <Route path="meu-trabalho" element={<RequireRole roles={["TECNICO"]}><MyWorkPage key="GERADORES" tipo="GERADORES" /></RequireRole>} />
            <Route path="dashboard" element={perm("dashboard", "view", <DashboardPage key="GERADORES" tipo="GERADORES" />)} />
            <Route path="mapas" element={perm("billing_generators", "view", <MapsPage />)} />
            <Route path="mapas/:id" element={perm("billing_generators", "view", <MapPage />)} />
            <Route path="validacoes" element={perm("billing_generators", "view", <ValidationsPage />)} />
            <Route path="sites" element={perm("billing_generators", "view", <SitesPage />)} />
            <Route path="relatorios" element={perm("reports", "view", <ReportsPage key="GERADORES" tipo="GERADORES" />)} />
            <Route path="parceiros" element={perm("providers", "view", <ProvidersPage key="GERADORES" tipo="GERADORES" />)} />
            <Route path="faixas-desconto" element={perm("prices_targets", "view", <DiscountRulesPage />)} />
            <Route path="targets" element={perm("prices_targets", "view", <TargetsPage />)} />
          </Route>

          <Route path="utilizadores" element={perm("users", "view", <UsersPage />)} />
          <Route path="utilizadores/:id/permissoes" element={perm("users", "view", <UserPermissionsPage />)} />
          <Route path="equipas" element={perm("teams", "view", <TeamsPage />)} />
          <Route path="sem-acesso" element={<NoAccess />} />
          {/* Endereços antigos e página inicial do perfil (homePath) → página inicial do módulo */}
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

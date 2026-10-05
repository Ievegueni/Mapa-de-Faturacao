import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui";
import { HomeRedirect, RequireAuth, RequirePermission, RequireRole } from "./components/guards";
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

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/trocar-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<RequirePermission module="dashboard" action="view"><DashboardPage /></RequirePermission>} />
        <Route path="meu-trabalho" element={<RequireRole roles={["TECNICO"]}><MyWorkPage /></RequireRole>} />
        <Route path="utilizadores" element={<RequirePermission module="users" action="view"><UsersPage /></RequirePermission>} />
        <Route path="utilizadores/:id/permissoes" element={<RequirePermission module="users" action="view"><UserPermissionsPage /></RequirePermission>} />
        <Route path="equipas" element={<RequirePermission module="teams" action="view"><TeamsPage /></RequirePermission>} />
        <Route path="facturacao/providers" element={<RequirePermission module="billing_providers" action="view"><BillingProvidersPage /></RequirePermission>} />
        <Route path="geradores/mapas" element={<RequirePermission module="billing_generators" action="view"><MapsPage /></RequirePermission>} />
        <Route path="geradores/mapas/:id" element={<RequirePermission module="billing_generators" action="view"><MapPage /></RequirePermission>} />
        <Route path="geradores/validacoes" element={<RequirePermission module="billing_generators" action="view"><ValidationsPage /></RequirePermission>} />
        <Route path="geradores/sites" element={<RequirePermission module="billing_generators" action="view"><SitesPage /></RequirePermission>} />
        <Route path="relatorios" element={<RequirePermission module="reports" action="view"><ReportsPage /></RequirePermission>} />
        <Route path="providers" element={<RequirePermission module="providers" action="view"><ProvidersPage /></RequirePermission>} />
        <Route path="faixas-desconto" element={<RequirePermission module="prices_targets" action="view"><DiscountRulesPage /></RequirePermission>} />
        <Route path="targets" element={<RequirePermission module="prices_targets" action="view"><TargetsPage /></RequirePermission>} />
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

import { Route, Routes } from "react-router-dom";
import { HomeRedirect, RequireAuth, RequirePermission, RequireRole } from "./components/guards";
import AppLayout from "./layouts/AppLayout";
import BillingProvidersPage from "./pages/billing-providers/BillingProvidersPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import DashboardPage from "./pages/DashboardPage";
import DiscountRulesPage from "./pages/DiscountRulesPage";
import LoginPage from "./pages/LoginPage";
import MyWorkPage from "./pages/MyWorkPage";
import ProvidersPage from "./pages/ProvidersPage";
import SitesPage from "./pages/generators/SitesPage";
import MapPage from "./pages/generators/MapPage";
import MapsPage from "./pages/generators/MapsPage";
import ValidationsPage from "./pages/generators/ValidationsPage";
import TargetsPage from "./pages/TargetsPage";
import TeamsPage from "./pages/TeamsPage";
import UserPermissionsPage from "./pages/UserPermissionsPage";
import UsersPage from "./pages/UsersPage";

export default function App() {
  return (
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
        <Route path="providers" element={<RequirePermission module="providers" action="view"><ProvidersPage /></RequirePermission>} />
        <Route path="faixas-desconto" element={<RequirePermission module="prices_targets" action="view"><DiscountRulesPage /></RequirePermission>} />
        <Route path="targets" element={<RequirePermission module="prices_targets" action="view"><TargetsPage /></RequirePermission>} />
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  );
}

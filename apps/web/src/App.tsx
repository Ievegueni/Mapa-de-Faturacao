import { Route, Routes } from "react-router-dom";
import { HomeRedirect, RequireAuth, RequirePermission, RequireRole } from "./components/guards";
import AppLayout from "./layouts/AppLayout";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import MyWorkPage from "./pages/MyWorkPage";
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
        <Route path="dashboard" element={<RequireRole roles={["GESTOR", "SUPERVISOR"]}><RequirePermission module="dashboard" action="view"><DashboardPage /></RequirePermission></RequireRole>} />
        <Route path="meu-trabalho" element={<RequireRole roles={["TECNICO"]}><MyWorkPage /></RequireRole>} />
        <Route path="utilizadores" element={<RequirePermission module="users" action="view"><UsersPage /></RequirePermission>} />
        <Route path="utilizadores/:id/permissoes" element={<RequirePermission module="users" action="view"><UserPermissionsPage /></RequirePermission>} />
        <Route path="equipas" element={<RequirePermission module="teams" action="view"><TeamsPage /></RequirePermission>} />
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  );
}

import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePasswordSchema, PASSWORD_MIN } from "@cf/shared";
import { useAuth } from "../hooks/useAuth";
import { apiPost } from "../lib/api";
import type { Me } from "../lib/types";
import { Alert, Button, Card, Field, Input, errorMessage } from "../components/ui";

export default function ChangePasswordPage() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = !!user?.mustChangePassword;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirm) return setError("As passwords não coincidem");
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true);
    try {
      const me = await apiPost<Me>("/auth/change-password", parsed.data);
      setUser(me);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <Card className="w-full max-w-md p-8">
        <img src="/unitel-logo.png" alt="Unitel" className="h-10 w-auto" />
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-navy-950">Definir nova password</h1>
        <p className="mt-1 text-sm text-ink-500">
          {forced ? "Por segurança, troque a password temporária antes de continuar." : "Altere a sua password de acesso."}
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field label="Password actual">
            <Input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </Field>
          <Field label="Nova password" hint={`Mínimo de ${PASSWORD_MIN} caracteres.`}>
            <Input type="password" autoComplete="new-password" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirmar nova password">
            <Input type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy ? "A guardar…" : "Guardar password"}
            </Button>
            <Button variant="ghost" onClick={forced ? logout : () => navigate(-1)}>
              {forced ? "Sair" : "Cancelar"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

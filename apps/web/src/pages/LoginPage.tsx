import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Alert, Button, Field, Input, errorMessage } from "../components/ui";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.mustChangePassword ? "/trocar-password" : user.homePath} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(email, password);
      navigate(me.mustChangePassword ? "/trocar-password" : me.homePath, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-50 px-4">
      <div className="pointer-events-none absolute -right-40 -top-40 size-[480px] rounded-full bg-brand-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 size-[480px] rounded-full bg-navy-500/10 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl bg-white p-8 shadow-xl shadow-navy-950/5 ring-1 ring-ink-100 sm:p-10">
          <img src="/unitel-logo.png" alt="Unitel" className="mx-auto h-12 w-auto" />
          <div className="mt-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-navy-950">Controlo de Facturação</h1>
            <p className="mt-1 text-sm text-ink-500">Entre com as suas credenciais</p>
          </div>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "A entrar…" : "Entrar"}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-ink-400">Acesso restrito à equipa de Manutenção de Rede da Unitel.</p>
      </div>
    </div>
  );
}

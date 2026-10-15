import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { Button } from "../components/Button";
import { PasswordField, TextField } from "../components/TextField";
import { errorMessage } from "../lib/messages";
import { validateEmail } from "../lib/validation";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = { email: validateEmail(email), password: password ? undefined : "Informe sua senha." };
    setErrors(next);
    setFormError("");
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Entrar" subtitle="Acesse sua conta para ver as aulas.">
      <form onSubmit={onSubmit} noValidate>
        {formError && <Alert>{formError}</Alert>}
        <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordField label="Senha" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Button type="submit" loading={busy}>
          Entrar
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">Esqueceu a senha? Fale com o estúdio para receber uma senha temporária.</p>
      <p className="mt-6 text-center text-muted">
        Ainda não tem conta?{" "}
        <Link to="/cadastro" className="font-medium text-brand-light underline">
          Cadastre-se
        </Link>
      </p>
    </AuthLayout>
  );
}

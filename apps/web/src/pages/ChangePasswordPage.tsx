import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { Button } from "../components/Button";
import { PasswordField } from "../components/TextField";
import { errorMessage } from "../lib/messages";
import { validateConfirmation, validateNewPassword } from "../lib/validation";

export default function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<{ current?: string; password?: string; confirmation?: string }>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = {
      current: current ? undefined : "Informe a senha atual.",
      password: validateNewPassword(password),
      confirmation: validateConfirmation(password, confirmation),
    };
    setErrors(next);
    setFormError("");
    if (next.current || next.password || next.confirmation) return;
    setBusy(true);
    try {
      await changePassword(current, password);
      navigate("/", { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Crie uma nova senha" subtitle="Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.">
      <form onSubmit={onSubmit} noValidate>
        {formError && <Alert>{formError}</Alert>}
        <PasswordField label="Senha atual" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
        <PasswordField label="Nova senha" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="Pelo menos 8 caracteres." />
        <PasswordField label="Confirmar nova senha" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} error={errors.confirmation} />
        <Button type="submit" loading={busy}>
          Salvar senha
        </Button>
      </form>
      <button type="button" onClick={() => void logout()} className="mt-6 block w-full text-center text-muted underline">
        Sair
      </button>
    </AuthLayout>
  );
}

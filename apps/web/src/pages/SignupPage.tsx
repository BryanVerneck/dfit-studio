import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { Button } from "../components/Button";
import { PasswordField, SelectField, TextField } from "../components/TextField";
import { STUDIO_SLUG } from "../config";
import { publicRequest } from "../lib/api";
import { errorMessage } from "../lib/messages";
import { validateConfirmation, validateEmail, validateNewPassword } from "../lib/validation";

type Errors = Partial<Record<"name" | "email" | "password" | "confirmation", string>>;

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", gender: "", password: "", confirmation: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {
      name: form.name.trim() ? undefined : "Informe seu nome.",
      email: validateEmail(form.email),
      password: validateNewPassword(form.password),
      confirmation: validateConfirmation(form.password, form.confirmation),
    };
    setErrors(next);
    setFormError("");
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    try {
      await publicRequest("/auth/register", "POST", {
        studioSlug: STUDIO_SLUG,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(form.phone.trim() && { phone: form.phone.trim() }),
        ...(form.gender && { gender: form.gender }),
      });
      setDone(true);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout title="Cadastro enviado">
        <p className="text-muted">
          Recebemos seu cadastro. Assim que o estúdio aprovar, você poderá entrar com seu e-mail e senha.
        </p>
        <Link to="/entrar" className="mt-6 block text-center font-medium text-brand-light underline">
          Voltar para o login
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Seu cadastro será aprovado pelo estúdio.">
      <form onSubmit={onSubmit} noValidate>
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Nome" autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
        <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set("email")} error={errors.email} />
        <TextField label="Telefone (opcional)" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={set("phone")} />
        <SelectField label="Gênero (opcional)" value={form.gender} onChange={set("gender")}>
          <option value="">Prefiro não informar</option>
          <option value="feminino">Feminino</option>
          <option value="masculino">Masculino</option>
          <option value="outro">Outro</option>
        </SelectField>
        <PasswordField label="Senha" autoComplete="new-password" value={form.password} onChange={set("password")} error={errors.password} hint="Pelo menos 8 caracteres." />
        <PasswordField label="Confirmar senha" autoComplete="new-password" value={form.confirmation} onChange={set("confirmation")} error={errors.confirmation} />
        <Button type="submit" loading={busy}>
          Criar conta
        </Button>
      </form>
      <p className="mt-6 text-center text-muted">
        Já tem conta?{" "}
        <Link to="/entrar" className="font-medium text-brand-light underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}

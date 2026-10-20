import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { HeaderLogo } from "../components/HeaderLogo";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { TextField } from "../components/TextField";
import { ApiError } from "../lib/api";
import { errorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import { createStudent } from "../lib/staff";
import { validateEmail } from "../lib/validation";

const LIMIT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }));
const emptyForm = { name: "", email: "", phone: "", weeklyLimit: "3" };

export default function NewStudentPage() {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);

  const set = (field: "name" | "email" | "phone") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { name: form.name.trim() ? undefined : "Informe o nome.", email: validateEmail(form.email) };
    setErrors(next);
    if (next.name || next.email) return;
    setBusy(true);
    try {
      const phone = form.phone.trim();
      const { temporaryPassword } = await createStudent({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: phone || undefined,
        weeklyLimit: Number(form.weeklyLimit),
      });
      setCreated({ name: form.name.trim(), email: form.email.trim().toLowerCase(), password: temporaryPassword });
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_taken") setErrors({ email: "Já existe um aluno com este e-mail." });
      else notifyError(errorMessage(err));
    }
    setBusy(false);
  }

  async function copy(password: string) {
    try {
      await navigator.clipboard.writeText(password);
      notifySuccess("Senha copiada.");
    } catch {
      notifyError("Não foi possível copiar. Anote a senha manualmente.");
    }
  }

  const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 text-center font-semibold hover:border-brand-light";
  const primary = "flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <HeaderLogo />
        <nav className="flex items-center">
          <Link to="/equipe/alunos" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Alunos
          </Link>
          <Link to="/" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Aulas
          </Link>
        </nav>
      </header>

      <h1 className="mt-6 text-2xl font-semibold">Novo aluno</h1>

      {created ? (
        <div className="mt-4 rounded-xl border border-success/60 p-4" role="group" aria-label="Aluno criado">
          <p className="font-semibold">{created.name} foi cadastrado.</p>
          <p className="text-muted">{created.email}</p>
          <p className="mt-4 text-sm text-muted">Senha temporária (aparece só agora):</p>
          <p className="my-2 select-all break-all font-mono text-2xl font-semibold tracking-wide">{created.password}</p>
          <p className="mb-4 text-sm text-muted">Passe para o aluno. No primeiro acesso, ele vai precisar criar uma senha nova.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void copy(created.password)} className={primary}>
              Copiar
            </button>
            <button
              type="button"
              onClick={() => {
                setCreated(null);
                setForm(emptyForm);
              }}
              className={secondary}
            >
              Cadastrar outro
            </button>
          </div>
          <Link to="/equipe/alunos" className="mt-3 block text-center text-sm text-muted underline hover:text-white">
            Ver alunos
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1 text-muted">Cadastre alguém direto, sem pedir que a pessoa se cadastre e espere a aprovação.</p>
          <form onSubmit={submit} noValidate className="mt-6">
            <TextField label="Nome" autoComplete="off" value={form.name} onChange={set("name")} error={errors.name} />
            <TextField label="E-mail" type="email" autoComplete="off" inputMode="email" value={form.email} onChange={set("email")} error={errors.email} />
            <TextField label="Telefone (opcional)" type="tel" autoComplete="off" inputMode="tel" value={form.phone} onChange={set("phone")} />
            <Select label="Aulas por semana" value={form.weeklyLimit} onChange={(v) => setForm({ ...form, weeklyLimit: v })} options={LIMIT_OPTIONS} />
            <Button type="submit" loading={busy}>
              Cadastrar aluno
            </Button>
          </form>
        </>
      )}
    </main>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import logo from "../assets/logo.png";
import { Alert } from "../components/Alert";
import { errorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import { approveStudent, fetchPendingStudents, type PendingStudent } from "../lib/staff";

const LIMITS = [1, 2, 3, 4, 5, 6, 7];

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingStudent[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [choosing, setChoosing] = useState<string | null>(null);
  const [limit, setLimit] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPending(await fetchPendingStudents());
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(student: PendingStudent) {
    setBusy(student.userId);
    try {
      await approveStudent(student.userId, limit);
      notifySuccess(`${student.name} foi aprovado(a).`);
      setChoosing(null);
    } catch (err) {
      notifyError(errorMessage(err));
    }
    await load();
    setBusy(null);
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <img src={logo} alt="Dfit Studio" className="h-10 w-auto" />
        <Link to="/" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
          Voltar às aulas
        </Link>
      </header>

      <h1 className="mt-6 text-2xl font-semibold">Cadastros pendentes</h1>
      <p className="mt-1 text-muted">Aprove os alunos novos e defina quantas aulas por semana cada um pode fazer.</p>

      <div className="mt-6" aria-live="polite">
        {loadError && <Alert>{loadError}</Alert>}
        {!loadError && pending === null && <p className="text-muted">Carregando…</p>}
        {pending && pending.length === 0 && <p className="text-muted">Nenhum cadastro pendente.</p>}
        <ul className="space-y-3">
          {pending?.map((s) => (
            <li key={s.userId} className="rounded-xl border border-line/60 bg-surface p-4">
              <p className="text-lg font-semibold">{s.name}</p>
              <p className="text-muted">{s.email}</p>
              {s.phone && <p className="text-muted">{s.phone}</p>}
              <div className="mt-3">
                {choosing === s.userId ? (
                  <div role="group" aria-label={`Aprovar ${s.name}`}>
                    <label htmlFor={`limit-${s.userId}`} className="mb-1 block text-sm text-muted">
                      Aulas por semana
                    </label>
                    <select
                      id={`limit-${s.userId}`}
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      className="mb-3 block w-full rounded-lg border border-line bg-ink px-3 py-3 text-base text-white"
                    >
                      {LIMITS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void approve(s)}
                        className="flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                      >
                        {busy === s.userId ? "Aprovando…" : "Confirmar"}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setChoosing(null)}
                        className="flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setChoosing(s.userId)}
                    className="w-full rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white hover:brightness-110"
                  >
                    Aprovar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

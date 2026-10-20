import { useCallback, useEffect, useState } from "react";
import { Alert } from "./Alert";
import { Select } from "./Select";
import { errorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import { approveStudent, fetchPendingStudents, type PendingStudent } from "../lib/staff";

const LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }));

// New sign-ups waiting for staff: approving one also sets how many classes a week the student may take.
export function PendingStudents() {
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
    <section aria-labelledby="new-students-title">
      <h2 id="new-students-title" className="text-xl font-semibold">
        Novos alunos
      </h2>
      <p className="mt-1 text-muted">Aprove os cadastros e defina quantas aulas por semana cada aluno pode fazer.</p>

      <div className="mt-4" aria-live="polite">
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
                    <Select
                      label="Aulas por semana"
                      value={String(limit)}
                      onChange={(v) => setLimit(Number(v))}
                      options={LIMIT_OPTIONS}
                    />
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
    </section>
  );
}

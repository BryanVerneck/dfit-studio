import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { HeaderLogo } from "../components/HeaderLogo";
import { Alert } from "../components/Alert";
import { dayAndMonth, dayKey, formatTime, weekdayLong } from "../lib/dates";
import { errorMessage, staffErrorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import {
  addStudentToClass,
  cancelClass,
  fetchClassDetail,
  fetchStudents,
  removeBooking,
  type CancelledClass,
  type ClassDetail,
  type StudentRow,
} from "../lib/staff";

const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50";
const danger = "flex-1 rounded-lg bg-danger px-4 py-2.5 font-semibold text-ink disabled:opacity-50";

export default function ClassDetailPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<CancelledClass | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchClassDetail(id));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const day = detail ? dayKey(detail.session.startsAt) : "";
  const cancelled = detail?.session.status === "cancelled";
  const scheduled = detail?.session.status === "scheduled";
  const full = detail ? detail.roster.length >= detail.session.capacity : false;

  const candidates = useMemo(() => {
    const inClass = new Set((detail?.roster ?? []).map((r) => r.studentId));
    const q = query.trim().toLowerCase();
    return (students ?? [])
      .filter((s) => !inClass.has(s.studentId) && (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [students, detail, query]);

  async function openAdd() {
    setAdding(true);
    setCancelling(false);
    if (students) return;
    try {
      setStudents(await fetchStudents());
    } catch (err) {
      notifyError(errorMessage(err));
      setAdding(false);
    }
  }

  async function act(run: () => Promise<void>) {
    setBusy(true);
    try {
      await run();
    } catch (err) {
      notifyError(staffErrorMessage(err));
    }
    // Always reload so the list shows what really happened.
    await load();
    setBusy(false);
  }

  const addStudent = (student: StudentRow) =>
    act(async () => {
      await addStudentToClass(id, student.studentId);
      notifySuccess(`${student.name} foi adicionado à aula.`);
      setQuery("");
    });

  const remove = (bookingId: string, name: string) =>
    act(async () => {
      await removeBooking(bookingId);
      notifySuccess(`${name} foi removido da aula.`);
      setRemoving(null);
    });

  const cancelThisClass = () =>
    act(async () => {
      setOutcome(await cancelClass(id, note.trim() || undefined));
      notifySuccess("Aula cancelada.");
      setCancelling(false);
      setNote("");
    });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <HeaderLogo />
        <Link to="/" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
          Voltar às aulas
        </Link>
      </header>

      {error && <div className="mt-6"><Alert>{error}</Alert></div>}
      {!error && !detail && <p className="mt-6 text-muted">Carregando…</p>}

      {detail && (
        <>
          <h1 className="mt-6 text-2xl font-semibold">
            {formatTime(detail.session.startsAt)} · {detail.session.name}
          </h1>
          <p className="mt-1 text-muted">
            {weekdayLong(day)}, {dayAndMonth(day)}
          </p>
          {cancelled && <p className="mt-2 text-sm font-medium text-danger">Aula cancelada</p>}

          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line/60 bg-surface p-3">
              <dt className="text-sm text-muted">Alunos</dt>
              <dd className="text-xl font-semibold">
                {detail.roster.length} de {detail.session.capacity}
              </dd>
            </div>
            <div className="rounded-xl border border-line/60 bg-surface p-3">
              <dt className="text-sm text-muted">Vagas livres</dt>
              <dd className="text-xl font-semibold">{cancelled ? "—" : Math.max(detail.session.capacity - detail.roster.length, 0)}</dd>
            </div>
          </dl>

          {outcome && (
            <div className="mt-6 rounded-xl border border-danger/60 p-4" role="group" aria-label="Alunos para avisar">
              <p className="font-semibold">
                {outcome.bookingsCancelled === 0
                  ? "Nenhum aluno tinha reserva nesta aula."
                  : `Avise ${outcome.bookingsCancelled === 1 ? "este aluno" : `estes ${outcome.bookingsCancelled} alunos`}:`}
              </p>
              <ul className="mt-2 space-y-1">
                {outcome.affected.map((a) => (
                  <li key={a.studentId} className="text-sm">
                    {a.name}
                    {a.phone && <span className="text-muted"> · {a.phone}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2 className="mt-6 text-lg font-semibold">Alunos nesta aula</h2>
          {detail.roster.length === 0 ? (
            <p className="mt-2 text-muted">Nenhum aluno inscrito.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.roster.map((r) => (
                <li key={r.bookingId} className="rounded-xl border border-line/60 bg-surface px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      {r.phone && <p className="text-sm text-muted">{r.phone}</p>}
                    </div>
                    <span className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted">
                      {r.source === "standing" ? "Horário fixo" : "Avulsa"}
                    </span>
                  </div>
                  {scheduled &&
                    (removing === r.bookingId ? (
                      <div className="mt-3" role="group" aria-label={`Remover ${r.name}`}>
                        <p className="mb-2 text-sm">Remover {r.name} desta aula?</p>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={() => void remove(r.bookingId, r.name)} className={danger}>
                            {busy ? "Removendo…" : "Sim, remover"}
                          </button>
                          <button type="button" disabled={busy} onClick={() => setRemoving(null)} className={secondary}>
                            Manter
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-right">
                        <button type="button" onClick={() => setRemoving(r.bookingId)} className="rounded-lg px-1 py-1 text-sm text-danger underline hover:brightness-125">
                          Remover
                        </button>
                      </div>
                    ))}
                </li>
              ))}
            </ul>
          )}

          {scheduled && (
            <div className="mt-6 space-y-3">
              {adding ? (
                <div className="rounded-xl border border-line/60 bg-surface p-4" role="group" aria-label="Adicionar aluno">
                  <label htmlFor="student-search" className="mb-1 block text-sm text-muted">
                    Buscar aluno por nome ou e-mail
                  </label>
                  <input
                    id="student-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="block w-full rounded-lg border border-line bg-ink px-3 py-3 text-base text-white focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/40"
                  />
                  {full && <p className="mt-2 text-sm text-danger">Esta aula está lotada.</p>}
                  {students === null && <p className="mt-3 text-sm text-muted">Carregando…</p>}
                  {students && candidates.length === 0 && <p className="mt-3 text-sm text-muted">Nenhum aluno encontrado.</p>}
                  <ul className="mt-3 space-y-2">
                    {candidates.map((s) => (
                      <li key={s.studentId} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{s.name}</p>
                          <p className="truncate text-sm text-muted">{s.email}</p>
                        </div>
                        <button
                          type="button"
                          disabled={busy || full}
                          aria-label={`Adicionar ${s.name}`}
                          onClick={() => void addStudent(s)}
                          className="shrink-0 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Adicionar
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => setAdding(false)} className="mt-3 text-sm text-muted underline hover:text-white">
                    Fechar
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => void openAdd()} className="w-full rounded-lg bg-linear-to-r from-brand to-violet px-4 py-3 font-semibold text-white hover:brightness-110">
                  Adicionar aluno
                </button>
              )}

              {cancelling ? (
                <div className="rounded-xl border border-danger/60 p-4" role="group" aria-label="Cancelar aula">
                  <p className="text-sm">
                    Cancelar esta aula? As reservas dos {detail.roster.length} alunos serão canceladas e eles verão que a aula foi cancelada.
                  </p>
                  <label htmlFor="cancel-note" className="mb-1 mt-3 block text-sm text-muted">
                    Motivo (opcional, os alunos veem)
                  </label>
                  <input
                    id="cancel-note"
                    type="text"
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="block w-full rounded-lg border border-line bg-surface px-3 py-3 text-base text-white focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/40"
                  />
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void cancelThisClass()} className={danger}>
                      {busy ? "Cancelando…" : "Sim, cancelar aula"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setCancelling(false)} className={secondary}>
                      Manter
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCancelling(true);
                    setAdding(false);
                  }}
                  className="w-full rounded-lg border border-danger/60 px-4 py-3 font-semibold text-danger hover:bg-danger/10"
                >
                  Cancelar aula
                </button>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { HeaderLogo } from "../components/HeaderLogo";
import { Alert } from "../components/Alert";
import { FixedPanel } from "../components/FixedPanel";
import { RequestsLink } from "../components/RequestsLink";
import { Select } from "../components/Select";
import { ApiError } from "../lib/api";
import { errorMessage, staffErrorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import { createTemporaryPassword, fetchStudents, setWeeklyLimit, type StudentRow } from "../lib/staff";
import { addFixedClass, endFixedClass, fetchAllFixed, fetchSlotsForStaff, slotLabel, type FixedClass, type Slot } from "../lib/standing";

const LIMIT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }));

type Panel = { id: string; mode: "limit" | "fixed" | "confirm-password" | "password"; password?: string };

const limitText = (limit: number | null) =>
  limit === null ? "Sem plano definido" : `${limit} ${limit === 1 ? "aula" : "aulas"} por semana`;

export default function StudentsPage() {
  const { logout } = useAuth();
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [limit, setLimit] = useState(3);
  const [busy, setBusy] = useState(false);
  const [fixed, setFixed] = useState<FixedClass[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [ending, setEnding] = useState<string | null>(null);
  const [fullWarning, setFullWarning] = useState(false);

  const load = useCallback(async () => {
    try {
      setStudents(await fetchStudents());
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (students ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [students, query]);

  async function saveLimit(student: StudentRow) {
    setBusy(true);
    try {
      const { removedFixedClasses = 0 } = await setWeeklyLimit(student.studentId, limit);
      notifySuccess(
        removedFixedClasses > 0
          ? `Limite de ${student.name} atualizado. ${removedFixedClasses === 1 ? "O horário fixo foi removido" : `Os ${removedFixedClasses} horários fixos foram removidos`}.`
          : `Limite de ${student.name} atualizado.`,
      );
      setPanel(null);
      await load();
    } catch (err) {
      notifyError(errorMessage(err));
    }
    setBusy(false);
  }

  // Fixed classes are fetched only when a student's panel opens, so the list itself stays one quick request.
  async function loadFixed() {
    const [allFixed, allSlots] = await Promise.all([fetchAllFixed(), fetchSlotsForStaff()]);
    setFixed(allFixed);
    setSlots(allSlots);
  }

  async function openFixed(student: StudentRow) {
    setSlotId("");
    setEnding(null);
    setFullWarning(false);
    try {
      await loadFixed();
      setPanel({ id: student.studentId, mode: "fixed" });
    } catch (err) {
      notifyError(staffErrorMessage(err));
    }
  }

  async function addFixed(student: StudentRow, chosen: string, allowOverCapacity: boolean) {
    setBusy(true);
    try {
      await addFixedClass(student.studentId, chosen, allowOverCapacity);
      notifySuccess(`Horário fixo de ${student.name} adicionado.`);
      setFullWarning(false);
      await loadFixed();
    } catch (err) {
      // A full class is not an error to hide: staff see it and choose to add one more student anyway.
      if (err instanceof ApiError && err.code === "class_full") setFullWarning(true);
      else notifyError(staffErrorMessage(err));
    }
    setBusy(false);
  }

  async function endFixed(student: StudentRow, enrollment: FixedClass) {
    setBusy(true);
    try {
      await endFixedClass(enrollment.id);
      notifySuccess(`${slotLabel(enrollment)} encerrado para ${student.name}.`);
      setEnding(null);
      await loadFixed();
    } catch (err) {
      notifyError(staffErrorMessage(err));
    }
    setBusy(false);
  }

  async function generatePassword(student: StudentRow) {
    setBusy(true);
    try {
      const { temporaryPassword } = await createTemporaryPassword(student.userId);
      setPanel({ id: student.userId, mode: "password", password: temporaryPassword });
    } catch (err) {
      notifyError(errorMessage(err));
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

  const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50";
  const primary = "flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white disabled:opacity-50";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <HeaderLogo />
        <nav className="flex items-center">
          <Link to="/" className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Aulas
          </Link>
          <RequestsLink />
          <button type="button" onClick={() => void logout()} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
            Sair
          </button>
        </nav>
      </header>

      <div className="mt-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Alunos</h1>
        <Link to="/equipe/alunos/novo" className="rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">
          Novo aluno
        </Link>
      </div>
      <p className="mt-1 text-muted">Veja o limite semanal de cada aluno e gere uma senha temporária quando alguém esquecer a senha.</p>

      <div className="mt-6">
        <label htmlFor="search" className="mb-1 block text-sm text-muted">
          Buscar por nome ou e-mail
        </label>
        <input
          id="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="block w-full rounded-lg border border-line bg-surface px-3 py-3 text-base text-white focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/40"
        />
      </div>

      <div className="mt-4" aria-live="polite">
        {loadError && <Alert>{loadError}</Alert>}
        {!loadError && students === null && <p className="text-muted">Carregando…</p>}
        {students && visible.length === 0 && <p className="text-muted">Nenhum aluno encontrado.</p>}
        <ul className="space-y-3">
          {visible.map((s) => {
            const open = panel?.id === s.userId || panel?.id === s.studentId ? panel : null;
            return (
              <li key={s.studentId} className="rounded-xl border border-line/60 bg-surface p-4">
                <p className="text-lg font-semibold">{s.name}</p>
                <p className="text-muted">{s.email}</p>
                {s.phone && <p className="text-muted">{s.phone}</p>}
                <p className={`mt-2 text-sm font-medium ${s.weeklyLimit === null ? "text-danger" : "text-brand-light"}`}>{limitText(s.weeklyLimit)}</p>

                {!open && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLimit(s.weeklyLimit ?? 3);
                        setPanel({ id: s.studentId, mode: "limit" });
                        // Needed only for the warning below, so a failure here is not worth an error.
                        void loadFixed().catch(() => {});
                      }}
                      className={secondary}
                    >
                      Alterar limite
                    </button>
                    <button
                      type="button"
                      onClick={() => void openFixed(s)}
                      className={secondary}
                    >
                      Horário fixo
                    </button>
                    <button type="button" onClick={() => setPanel({ id: s.userId, mode: "confirm-password" })} className={secondary}>
                      Senha temporária
                    </button>
                  </div>
                )}

                {open?.mode === "limit" && (
                  <div className="mt-3" role="group" aria-label={`Limite de ${s.name}`}>
                    <Select label="Aulas por semana" value={String(limit)} onChange={(v) => setLimit(Number(v))} options={LIMIT_OPTIONS} />
                    {(() => {
                      const held = fixed.filter((f) => f.studentId === s.studentId && f.validTo === null).length;
                      return held > limit ? (
                        <p className="mb-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                          {s.name} tem {held} horários fixos, mais do que {limit === 1 ? "1 aula" : `${limit} aulas`} por semana. Se salvar, todos os horários fixos serão removidos.
                        </p>
                      ) : null;
                    })()}
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void saveLimit(s)} className={primary}>
                        {busy ? "Salvando…" : "Salvar"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setPanel(null)} className={secondary}>
                        Voltar
                      </button>
                    </div>
                  </div>
                )}

                {open?.mode === "fixed" && (
                  <FixedPanel
                    student={s}
                    classes={fixed.filter((f) => f.studentId === s.studentId)}
                    slots={slots}
                    slotId={slotId}
                    onSlot={(v) => {
                      setSlotId(v);
                      setFullWarning(false);
                    }}
                    ending={ending}
                    onEnding={setEnding}
                    fullWarning={fullWarning}
                    busy={busy}
                    onAdd={(chosen, allow) => void addFixed(s, chosen, allow)}
                    onEnd={(f) => void endFixed(s, f)}
                    onClose={() => setPanel(null)}
                  />
                )}

                {open?.mode === "confirm-password" && (
                  <div className="mt-3" role="group" aria-label={`Senha temporária de ${s.name}`}>
                    <p className="mb-3 text-sm">A senha atual de {s.name} deixará de funcionar e a pessoa será desconectada. Gerar senha temporária?</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void generatePassword(s)} className={primary}>
                        {busy ? "Gerando…" : "Gerar senha"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setPanel(null)} className={secondary}>
                        Voltar
                      </button>
                    </div>
                  </div>
                )}

                {open?.mode === "password" && open.password && (
                  <div className="mt-3 rounded-lg border border-success/60 p-3" role="group" aria-label={`Nova senha de ${s.name}`}>
                    <p className="text-sm text-muted">Senha temporária (aparece só agora):</p>
                    <p className="my-2 select-all break-all font-mono text-2xl font-semibold tracking-wide">{open.password}</p>
                    <p className="mb-3 text-sm text-muted">Passe para o aluno. No primeiro acesso, ele vai precisar criar uma senha nova.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void copy(open.password!)} className={primary}>
                        Copiar
                      </button>
                      <button type="button" onClick={() => setPanel(null)} className={secondary}>
                        Fechar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

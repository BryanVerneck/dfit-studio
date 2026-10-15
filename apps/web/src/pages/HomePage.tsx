import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import logo from "../assets/logo.png";
import { addDays, dayAndMonth, dayKey, dayNumber, formatTime, mondayOf, weekdayLong, weekdayShort } from "../lib/dates";
import { errorMessage } from "../lib/messages";
import { bookClass, fetchSessions, fetchUsage, type ClassSession, type WeeklyUsage } from "../lib/schedule";

export default function HomePage() {
  const { state, logout } = useAuth();
  const today = dayKey(new Date());
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [selected, setSelected] = useState(today);
  const [sessions, setSessions] = useState<ClassSession[] | null>(null);
  const [usage, setUsage] = useState<WeeklyUsage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [booking, setBooking] = useState<string | null>(null);

  const isStudent = state.status === "authenticated" && state.user.role === "student";
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    try {
      const [list, used] = await Promise.all([
        fetchSessions(weekStart, addDays(weekStart, 6)),
        isStudent ? fetchUsage(weekStart) : Promise.resolve(null),
      ]);
      setSessions(list);
      setUsage(used);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [weekStart, isStudent]);

  useEffect(() => {
    setSessions(null);
    void load();
  }, [load]);

  function changeWeek(delta: number) {
    const next = addDays(weekStart, delta * 7);
    setWeekStart(next);
    setSelected(next === mondayOf(today) ? today : next);
    setActionError("");
  }

  async function book(session: ClassSession) {
    setBooking(session.id);
    setActionError("");
    try {
      await bookClass(session.id);
    } catch (err) {
      setActionError(errorMessage(err));
    }
    // Always reload: after a failure (for example a full class) the list shows the real situation.
    await load();
    setBooking(null);
  }

  if (state.status !== "authenticated") return null;
  const daySessions = (sessions ?? []).filter((s) => dayKey(s.startsAt) === selected);
  const hasClasses = (key: string) => (sessions ?? []).some((s) => dayKey(s.startsAt) === key);
  const now = Date.now();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <img src={logo} alt="Dfit Studio" className="h-10 w-auto" />
        <button type="button" onClick={() => void logout()} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white">
          Sair
        </button>
      </header>

      <h1 className="mt-6 text-2xl font-semibold">Olá, {state.user.name.split(" ")[0]}</h1>
      {usage && (
        <p className="mt-1 text-muted">
          {usage.weeklyLimit === null
            ? "Seu plano ainda não foi configurado."
            : `Você usou ${usage.used} de ${usage.weeklyLimit} ${usage.weeklyLimit === 1 ? "aula" : "aulas"} nesta semana.`}
        </p>
      )}

      <nav className="mt-6 flex items-center justify-between" aria-label="Semana">
        <button type="button" onClick={() => changeWeek(-1)} className="rounded-lg px-3 py-2 text-muted hover:text-white" aria-label="Semana anterior">
          ‹
        </button>
        <p className="text-sm text-muted">
          {dayAndMonth(days[0])} – {dayAndMonth(days[6])}
        </p>
        <button type="button" onClick={() => changeWeek(1)} className="rounded-lg px-3 py-2 text-muted hover:text-white" aria-label="Próxima semana">
          ›
        </button>
      </nav>

      <div className="mt-2 grid grid-cols-7 gap-1" role="tablist" aria-label="Dias da semana">
        {days.map((key) => {
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${weekdayLong(key)}, ${dayAndMonth(key)}`}
              onClick={() => setSelected(key)}
              className={`flex flex-col items-center rounded-lg py-2 text-sm ${active ? "bg-linear-to-b from-brand to-violet text-white" : "text-muted hover:text-white"}`}
            >
              <span className="capitalize">{weekdayShort(key)}</span>
              <span className="text-base font-semibold">{dayNumber(key)}</span>
              <span className={`mt-1 h-1 w-1 rounded-full ${hasClasses(key) && !active ? "bg-brand-light" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      <h2 className="mt-6 text-lg font-semibold">
        {weekdayLong(selected)}, {dayAndMonth(selected)}
      </h2>

      <div className="mt-3" aria-live="polite">
        {actionError && <Alert>{actionError}</Alert>}
        {loadError && <Alert>{loadError}</Alert>}
        {!loadError && sessions === null && <p className="text-muted">Carregando aulas…</p>}
        {sessions && daySessions.length === 0 && <p className="text-muted">Nenhuma aula neste dia.</p>}
        <ul className="space-y-3">
          {daySessions.map((s) => {
            const mine = s.myBookingId !== null;
            const started = new Date(s.startsAt).getTime() <= now;
            const full = s.spotsLeft === 0;
            return (
              <li key={s.id} className="rounded-xl border border-line/60 bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold">{formatTime(s.startsAt)}</p>
                    <p className="text-muted">
                      {s.name} · {s.durationMin} min
                    </p>
                  </div>
                  <p className={`text-sm ${full ? "text-danger" : "text-muted"}`}>
                    {full ? "Lotada" : `${s.spotsLeft} ${s.spotsLeft === 1 ? "vaga" : "vagas"}`}
                  </p>
                </div>
                {isStudent && (
                  <div className="mt-3">
                    {mine ? (
                      <p className="text-sm font-medium text-brand-light">✓ Você está nesta aula</p>
                    ) : started ? (
                      <p className="text-sm text-muted">Aula encerrada</p>
                    ) : (
                      <button
                        type="button"
                        disabled={full || booking !== null}
                        onClick={() => void book(s)}
                        className="w-full rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white hover:brightness-110 disabled:opacity-50"
                      >
                        {booking === s.id ? "Reservando…" : full ? "Sem vagas" : "Reservar"}
                      </button>
                    )}
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

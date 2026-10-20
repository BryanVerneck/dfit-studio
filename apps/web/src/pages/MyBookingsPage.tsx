import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { HeaderLogo } from "../components/HeaderLogo";
import { Alert } from "../components/Alert";
import { FixedSchedule } from "../components/FixedSchedule";
import { StudentTabs } from "../components/StudentTabs";
import { dayAndMonth, dayKey, formatTime, weekdayLong } from "../lib/dates";
import { errorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import {
  cancelBooking,
  fetchMyBookings,
  type MyBooking,
} from "../lib/schedule";

export default function MyBookingsPage() {
  const { state, logout } = useAuth();
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBookings(await fetchMyBookings());
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(booking: MyBooking) {
    setBusy(booking.id);
    try {
      await cancelBooking(booking.id);
      notifySuccess("Reserva cancelada.");
    } catch (err) {
      notifyError(errorMessage(err));
    }
    setConfirming(null);
    await load();
    setBusy(null);
  }

  if (state.status !== "authenticated") return null;
  if (state.user.role !== "student") return <Navigate to="/" replace />;

  // One-off classes only (the fixed ones are shown above, as the fixed schedule), and only those that have not finished yet.
  // A class the studio called off stays listed so the student knows why it vanished.
  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) =>
      b.source === "one_off" &&
      new Date(b.startsAt).getTime() + b.durationMin * 60_000 > now,
  );
  const days = [...new Set(upcoming.map((b) => dayKey(b.startsAt)))];

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <HeaderLogo />
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-lg px-3 py-2 text-sm text-muted hover:text-white"
        >
          Sair
        </button>
      </header>

      <StudentTabs />

      <FixedSchedule />

      <section className="mt-8" aria-labelledby="one-off-title">
        <h2 id="one-off-title" className="text-lg font-semibold">
          Trocas de horário
        </h2>
        <p className="mt-1 text-muted">
          Aulas que você reservou fora do horário fixo.
        </p>

        <div className="mt-4" aria-live="polite">
          {loadError && <Alert>{loadError}</Alert>}
          {!loadError && bookings === null && (
            <p className="text-muted">Carregando…</p>
          )}
          {bookings && upcoming.length === 0 && (
            <p className="text-muted">Você não tem aulas avulsas reservadas.</p>
          )}
          {days.map((day) => (
            <section key={day} className="mt-4">
              <h2 className="text-lg font-semibold">
                {weekdayLong(day)}, {dayAndMonth(day)}
              </h2>
              <ul className="mt-2 space-y-3">
                {upcoming
                  .filter((b) => dayKey(b.startsAt) === day)
                  .map((b) => {
                    const called = b.status !== "booked";
                    return (
                      <li
                        key={b.id}
                        className="rounded-xl border border-line/60 bg-surface p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xl font-semibold">
                              {formatTime(b.startsAt)}
                            </p>
                            <p className="text-muted">
                              {b.name} · {b.durationMin} min
                            </p>
                          </div>
                        </div>
                        {called ? (
                          <p className="mt-3 text-sm font-medium text-danger">
                            Aula cancelada pelo estúdio
                            {b.cancelNote ? `: ${b.cancelNote}` : "."}
                          </p>
                        ) : confirming === b.id ? (
                          <div
                            className="mt-3"
                            role="group"
                            aria-label="Confirmar cancelamento"
                          >
                            <p className="mb-2 text-sm">
                              Cancelar sua reserva?
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void cancel(b)}
                                className="flex-1 rounded-lg bg-danger px-4 py-2.5 font-semibold text-ink disabled:opacity-50"
                              >
                                {busy === b.id
                                  ? "Cancelando…"
                                  : "Sim, cancelar"}
                              </button>
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => setConfirming(null)}
                                className="flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50"
                              >
                                Manter
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setConfirming(b.id)}
                              className="rounded-lg px-3 py-2 text-sm text-danger underline hover:brightness-125"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}

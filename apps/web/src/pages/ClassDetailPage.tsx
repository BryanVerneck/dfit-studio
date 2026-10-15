import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import logo from "../assets/logo.png";
import { Alert } from "../components/Alert";
import { dayAndMonth, dayKey, formatTime, weekdayLong } from "../lib/dates";
import { errorMessage } from "../lib/messages";
import { fetchClassDetail, type ClassDetail } from "../lib/staff";

export default function ClassDetailPage() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [error, setError] = useState("");

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

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <img src={logo} alt="Dfit Studio" className="h-10 w-auto" />
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

          <h2 className="mt-6 text-lg font-semibold">Alunos nesta aula</h2>
          {detail.roster.length === 0 ? (
            <p className="mt-2 text-muted">Nenhum aluno inscrito.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.roster.map((r) => (
                <li key={r.bookingId} className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-surface px-4 py-3">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    {r.phone && <p className="text-sm text-muted">{r.phone}</p>}
                  </div>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    {r.source === "standing" ? "Horário fixo" : "Avulsa"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

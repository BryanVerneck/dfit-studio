import { useCallback, useEffect, useState } from "react";
import { staffErrorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import { approveRequest, describeRequest, fetchPendingRequests, rejectRequest, type PendingRequest } from "../lib/standing";
import { Alert } from "./Alert";

const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50";
const primary = "flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white disabled:opacity-50";

// Students ask to join, leave or move between fixed classes; staff answer here.
export function FixedRequests() {
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchPendingRequests());
      setLoadError("");
    } catch (err) {
      setLoadError(staffErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(r: PendingRequest, allowOverCapacity: boolean) {
    setBusy(r.id);
    try {
      const result = await approveRequest(r.id, allowOverCapacity);
      if (result.skipped.length > 0) {
        notifyError(`${r.studentName} foi atualizado(a), mas algumas aulas não puderam ser reservadas. Veja a lista de aulas.`);
      } else {
        notifySuccess(`Pedido de ${r.studentName} aprovado.`);
      }
    } catch (err) {
      notifyError(staffErrorMessage(err));
    }
    await load();
    setBusy(null);
  }

  async function reject(r: PendingRequest) {
    setBusy(r.id);
    try {
      await rejectRequest(r.id, reason.trim() || undefined);
      notifySuccess(`Pedido de ${r.studentName} recusado.`);
      setRejecting(null);
    } catch (err) {
      notifyError(staffErrorMessage(err));
    }
    await load();
    setBusy(null);
  }

  return (
    <section aria-labelledby="fixed-requests-title">
      <h2 id="fixed-requests-title" className="text-xl font-semibold">
        Horário fixo
      </h2>
      <p className="mt-1 text-muted">Alunos pedem para entrar, sair ou trocar de turma. Nada muda até você aprovar.</p>

      <div className="mt-4" aria-live="polite">
        {loadError && <Alert>{loadError}</Alert>}
        {!loadError && requests === null && <p className="text-muted">Carregando…</p>}
        {requests && requests.length === 0 && <p className="text-muted">Nenhum pedido no momento.</p>}
        <ul className="space-y-3">
          {requests?.map((r) => {
            // The class the student wants has no free seat in some coming sessions: approving adds one more student to it.
            const full = r.capacity && r.capacity.fullSessions > 0 ? r.capacity : null;
            return (
              <li key={r.id} className="rounded-xl border border-line/60 bg-surface p-4">
                <p className="text-lg font-semibold">{r.studentName}</p>
                {r.studentPhone && <p className="text-muted">{r.studentPhone}</p>}
                <p className="mt-2 font-medium text-brand-light">{describeRequest(r)}</p>
                {r.note && <p className="mt-1 text-sm text-muted">“{r.note}”</p>}

                {full && (
                  <p className="mt-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                    Turma cheia: {full.nextBooked} de {full.capacity} vagas
                    {full.fullSessions === full.totalSessions ? " em todas as próximas aulas" : ` e lotada em ${full.fullSessions} das próximas ${full.totalSessions} aulas`}.
                    Se aprovar, a turma passa a ter {full.capacity + 1} alunos.
                  </p>
                )}

                {rejecting === r.id ? (
                  <div className="mt-3" role="group" aria-label={`Recusar pedido de ${r.studentName}`}>
                    <label htmlFor={`reason-${r.id}`} className="mb-1 block text-sm text-muted">
                      Motivo (o aluno vai ler)
                    </label>
                    <input
                      id={`reason-${r.id}`}
                      type="text"
                      maxLength={300}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mb-3 block w-full rounded-lg border border-line bg-surface px-3 py-3 text-base text-white focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/40"
                    />
                    <div className="flex gap-2">
                      <button type="button" disabled={busy !== null} onClick={() => void reject(r)} className="flex-1 rounded-lg bg-danger px-4 py-2.5 font-semibold text-ink disabled:opacity-50">
                        {busy === r.id ? "Recusando…" : "Recusar pedido"}
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => setRejecting(null)} className={secondary}>
                        Voltar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy !== null} onClick={() => void approve(r, !!full)} className={primary}>
                      {busy === r.id ? "Aprovando…" : full ? "Aprovar mesmo assim" : "Aprovar"}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        setReason("");
                        setRejecting(r.id);
                      }}
                      className={secondary}
                    >
                      Recusar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

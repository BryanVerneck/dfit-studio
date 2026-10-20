import { useCallback, useEffect, useState } from "react";
import { dayAndMonth } from "../lib/dates";
import { errorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import {
  askForChange,
  fetchMyFixed,
  fetchMyRequests,
  fetchSlots,
  slotLabel,
  slotOptions,
  withdrawRequest,
  type FixedClass,
  type Slot,
  type StandingRequest,
} from "../lib/standing";
import { Alert } from "./Alert";
import { Select } from "./Select";

type Form = { kind: "new" } | { kind: "retry"; requestId: string } | { kind: "move"; from: FixedClass } | { kind: "leave"; from: FixedClass };

const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50";
const primary = "flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white disabled:opacity-50";

const statusText = { approved: "Aprovado", rejected: "Recusado", pending: "Pendente", cancelled: "Cancelado" } as const;
const statusColor = { approved: "text-success", rejected: "text-danger", pending: "text-yellow-400", cancelled: "text-muted" } as const;

const Status = ({ request }: { request: StandingRequest }) => <span className={statusColor[request.status]}>{statusText[request.status]}</span>;

const card = "rounded-xl border border-line/60 bg-surface p-4";

// The student's fixed classes, and the requests to change them. Staff decide; nothing changes until they approve.
export function FixedSchedule() {
  const [fixed, setFixed] = useState<FixedClass[] | null>(null);
  const [requests, setRequests] = useState<StandingRequest[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [slotId, setSlotId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, r, s] = await Promise.all([fetchMyFixed(), fetchMyRequests(), fetchSlots()]);
      setFixed(f);
      setRequests(r);
      setSlots(s);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Requests arrive newest first. Each shows inside the fixed class it is about: the class the student asked to leave or
  // move from, or, once approved, the class they moved to. A request to join a new class has no class yet, so it gets
  // a card of its own, the same as a fixed class: every pending one, or else the latest refused one.
  const requestFor = (f: FixedClass) =>
    requests.find((r) => r.from?.enrollmentId === f.id || (r.status === "approved" && r.to?.slotId === f.slotId));
  const joining = requests.filter((r) => !r.from && r.to && r.status === "pending");
  const refusedJoin = requests.find((r) => !r.from && r.to && r.status === "rejected");
  const standalone = refusedJoin && joining.length === 0 ? [refusedJoin] : joining;
  const current = (fixed ?? []).filter((f) => f.validTo === null);
  const options = slotOptions(slots, current.map((f) => f.slotId));

  function open(next: Form) {
    setForm(next);
    setNote("");
    setSlotId(options[0]?.value ?? "");
  }

  async function withdraw(id: string) {
    setBusy(true);
    try {
      await withdrawRequest(id);
      notifySuccess("Pedido cancelado.");
      await load();
    } catch (err) {
      notifyError(errorMessage(err));
    }
    setBusy(false);
  }

  async function send() {
    if (!form) return;
    setBusy(true);
    try {
      await askForChange({
        fromEnrollmentId: form.kind === "move" || form.kind === "leave" ? form.from.id : undefined,
        toSlotId: form.kind === "leave" ? undefined : slotId,
        note: note.trim() || undefined,
      });
      notifySuccess("Pedido enviado. O estúdio vai responder em breve.");
      setForm(null);
      await load();
    } catch (err) {
      notifyError(errorMessage(err));
    }
    setBusy(false);
  }

    return (
    <section className="mt-6" aria-labelledby="fixed-title">
      <h2 id="fixed-title" className="text-lg font-semibold">
        Aulas fixas
      </h2>
      {loadError && <Alert>{loadError}</Alert>}
      {!loadError && fixed === null && <p className="mt-2 text-muted">Carregando…</p>}
      {fixed && fixed.length === 0 && standalone.length === 0 && <p className="mt-1 text-muted">Você ainda não tem horário fixo. Peça um e o estúdio responde.</p>}

      <ul className="mt-2 space-y-3">
        {fixed?.map((f) => (
          <li key={f.id} className={card}>
            <p className="text-lg font-semibold">
              {slotLabel(f)}
              {requestFor(f) && (
                <>
                  {" "}
                  · <Status request={requestFor(f)!} />
                </>
              )}
            </p>
            <p className="text-muted">
              {f.name} · {f.durationMin} min
            </p>
            {f.validTo ? (
              <p className="mt-2 text-sm text-muted">Última aula neste horário: {dayAndMonth(f.validTo)}.</p>
            ) : form && (form.kind === "move" || form.kind === "leave") && form.from.id === f.id ? (
              <div className="mt-3" role="group" aria-label={form.kind === "move" ? "Pedir troca de horário" : "Pedir para sair do horário"}>
                {form.kind === "move" && <Select label="Novo horário" value={slotId} onChange={setSlotId} options={options} />}
                <NoteField value={note} onChange={setNote} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || (form.kind === "move" && !slotId)} onClick={() => void send()} className={primary}>
                    {busy ? "Enviando…" : "Enviar pedido"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setForm(null)} className={secondary}>
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <>
                {requestFor(f)?.status === "rejected" && requestFor(f)!.decisionNote && (
                  <p className="mt-2 text-sm text-muted">{requestFor(f)!.decisionNote}</p>
                )}
                {/* While a request waits the student can only take it back; after a refusal they can only ask to move. */}
                {requestFor(f)?.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void withdraw(requestFor(f)!.id)} className={secondary}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => open({ kind: "move", from: f })} className={secondary}>
                      Trocar horário
                    </button>
                    {requestFor(f)?.status !== "rejected" && (
                      <button type="button" onClick={() => open({ kind: "leave", from: f })} className={secondary}>
                        Sair
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </li>
        ))}
        {standalone.map((r) => (
          <li key={r.id} className={card}>
            <p className="text-lg font-semibold">
              {slotLabel(r.to!)} · <Status request={r} />
            </p>
            <p className="text-muted">
              {r.to!.name} · {r.to!.durationMin} min
            </p>
            {r.status === "rejected" && r.decisionNote && <p className="mt-2 text-sm text-muted">{r.decisionNote}</p>}
            {form?.kind === "retry" && form.requestId === r.id ? (
              <div className="mt-3" role="group" aria-label="Pedir troca de horário">
                <Select label="Novo horário" value={slotId} onChange={setSlotId} options={options} />
                <NoteField value={note} onChange={setNote} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || !slotId} onClick={() => void send()} className={primary}>
                    {busy ? "Enviando…" : "Enviar pedido"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setForm(null)} className={secondary}>
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                {r.status === "pending" ? (
                  <button type="button" disabled={busy} onClick={() => void withdraw(r.id)} className={secondary}>
                    Cancelar
                  </button>
                ) : (
                  <button type="button" onClick={() => open({ kind: "retry", requestId: r.id })} className={secondary}>
                    Trocar horário
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {form?.kind === "new" ? (
        <div className="mt-3 rounded-xl border border-line/60 bg-surface p-4" role="group" aria-label="Pedir horário fixo">
          <Select label="Horário que você quer" value={slotId} onChange={setSlotId} options={options} />
          <NoteField value={note} onChange={setNote} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !slotId} onClick={() => void send()} className={primary}>
              {busy ? "Enviando…" : "Enviar pedido"}
            </button>
            <button type="button" disabled={busy} onClick={() => setForm(null)} className={secondary}>
              Voltar
            </button>
          </div>
        </div>
      ) : (
        fixed && (
          <button type="button" onClick={() => open({ kind: "new" })} className="mt-3 w-full rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light">
            Pedir horário fixo
          </button>
        )
      )}

    </section>
  );
}

function NoteField({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <div className="mb-3">
      <label htmlFor="request-note" className="mb-1 block text-sm text-muted">
        Recado para o estúdio (opcional)
      </label>
      <input
        id="request-note"
        type="text"
        maxLength={300}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-line bg-surface px-3 py-3 text-base text-white focus:border-brand-light focus:outline-none focus:ring-2 focus:ring-brand-light/40"
      />
    </div>
  );
}

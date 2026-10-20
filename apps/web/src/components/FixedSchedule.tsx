import { useCallback, useEffect, useState } from "react";
import { dayAndMonth } from "../lib/dates";
import { errorMessage } from "../lib/messages";
import { notifyError, notifySuccess } from "../lib/notify";
import {
  askForChange,
  describeRequest,
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

type Form = { kind: "new" } | { kind: "move"; from: FixedClass } | { kind: "leave"; from: FixedClass };

const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50";
const primary = "flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white disabled:opacity-50";

const statusText = { approved: "Aprovado", rejected: "Recusado", pending: "Aguardando o estúdio", cancelled: "Cancelado" } as const;
const statusColor = { approved: "text-success", rejected: "text-danger", pending: "text-muted", cancelled: "text-muted" } as const;

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

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 3);
  // A class already asked to leave or move cannot be asked about again until the answer comes.
  const asked = new Set(pending.map((r) => r.from?.enrollmentId).filter(Boolean));
  const current = (fixed ?? []).filter((f) => f.validTo === null);
  const options = slotOptions(slots, current.map((f) => f.slotId));

  function open(next: Form) {
    setForm(next);
    setNote("");
    setSlotId(options[0]?.value ?? "");
  }

  async function send() {
    if (!form) return;
    setBusy(true);
    try {
      await askForChange({
        fromEnrollmentId: form.kind === "new" ? undefined : form.from.id,
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

  return (
    <section className="mt-6" aria-labelledby="fixed-title">
      <h2 id="fixed-title" className="text-lg font-semibold">
        Meu horário fixo
      </h2>
      {loadError && <Alert>{loadError}</Alert>}
      {!loadError && fixed === null && <p className="mt-2 text-muted">Carregando…</p>}
      {fixed && fixed.length === 0 && <p className="mt-1 text-muted">Você ainda não tem horário fixo. Peça um e o estúdio responde.</p>}

      <ul className="mt-2 space-y-3">
        {fixed?.map((f) => (
          <li key={f.id} className="rounded-xl border border-line/60 bg-surface p-4">
            <p className="text-lg font-semibold">{slotLabel(f)}</p>
            <p className="text-muted">
              {f.name} · {f.durationMin} min
            </p>
            {f.validTo ? (
              <p className="mt-2 text-sm text-muted">Última aula neste horário: {dayAndMonth(f.validTo)}.</p>
            ) : form && form.kind !== "new" && form.from.id === f.id ? (
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
            ) : asked.has(f.id) ? (
              <p className="mt-2 text-sm text-muted">Pedido em análise.</p>
            ) : (
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => open({ kind: "move", from: f })} className={secondary}>
                  Trocar horário
                </button>
                <button type="button" onClick={() => open({ kind: "leave", from: f })} className={secondary}>
                  Sair
                </button>
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

      {(pending.length > 0 || decided.length > 0) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-muted">Pedidos</h3>
          <ul className="mt-2 space-y-2">
            {[...pending, ...decided].map((r) => (
              <li key={r.id} className="rounded-xl border border-line/60 bg-surface p-3">
                <p className="font-medium">{describeRequest(r)}</p>
                <p className={`text-sm font-medium ${statusColor[r.status]}`}>{statusText[r.status]}</p>
                {r.decisionNote && <p className="text-sm text-muted">{r.decisionNote}</p>}
                {r.status === "pending" && (
                  <button type="button" disabled={busy} onClick={() => void withdraw(r.id)} className="mt-1 text-sm text-danger underline disabled:opacity-50">
                    Cancelar pedido
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
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

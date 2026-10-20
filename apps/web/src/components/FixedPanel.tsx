import { dayAndMonth } from "../lib/dates";
import type { StudentRow } from "../lib/staff";
import { slotLabel, slotOptions, type FixedClass, type Slot } from "../lib/standing";
import { Select } from "./Select";

interface Props {
  student: StudentRow;
  classes: FixedClass[];
  slots: Slot[];
  slotId: string;
  onSlot(value: string): void;
  ending: string | null;
  onEnding(id: string | null): void;
  fullWarning: boolean;
  busy: boolean;
  onAdd(slotId: string, allowOverCapacity: boolean): void;
  onEnd(enrollment: FixedClass): void;
  onClose(): void;
}

const secondary = "flex-1 rounded-lg border border-line px-4 py-2.5 font-semibold hover:border-brand-light disabled:opacity-50";

// Staff view of one student's fixed classes. A fixed class counts against the weekly limit, so the limit comes first.
export function FixedPanel(p: Props) {
  const ongoing = p.classes.filter((c) => c.validTo === null);
  const options = slotOptions(p.slots, ongoing.map((c) => c.slotId));
  const chosen = p.slotId || options[0]?.value || "";
  const limit = p.student.weeklyLimit;
  const noRoom = limit === null || ongoing.length >= limit;

  return (
    <div className="mt-3" role="group" aria-label={`Horário fixo de ${p.student.name}`}>
      {p.classes.length === 0 && <p className="mb-3 text-sm text-muted">Nenhum horário fixo.</p>}
      <ul className="mb-3 space-y-2">
        {p.classes.map((c) => (
          <li key={c.id} className="rounded-lg border border-line/60 p-3">
            <p className="font-medium">
              {slotLabel(c)} <span className="text-muted">· {c.name}</span>
            </p>
            {c.validTo ? (
              <p className="text-sm text-muted">Última aula: {dayAndMonth(c.validTo)}.</p>
            ) : p.ending === c.id ? (
              <div className="mt-2">
                <p className="mb-2 text-sm">As próximas aulas deste horário serão canceladas agora. Encerrar?</p>
                <div className="flex gap-2">
                  <button type="button" disabled={p.busy} onClick={() => p.onEnd(c)} className="flex-1 rounded-lg bg-danger px-4 py-2.5 font-semibold text-ink disabled:opacity-50">
                    {p.busy ? "Encerrando…" : "Sim, encerrar"}
                  </button>
                  <button type="button" disabled={p.busy} onClick={() => p.onEnding(null)} className={secondary}>
                    Manter
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => p.onEnding(c.id)} className="mt-1 text-sm text-danger underline">
                Encerrar
              </button>
            )}
          </li>
        ))}
      </ul>

      {noRoom ? (
        <>
          <p className="mb-3 text-sm text-muted">
            {limit === null
              ? "Defina o limite semanal do aluno para adicionar horários fixos."
              : `O aluno já tem ${ongoing.length} de ${limit} horários fixos. Aumente o limite semanal para adicionar mais.`}
          </p>
          <button type="button" onClick={p.onClose} className={`${secondary} w-full`}>
            Fechar
          </button>
        </>
      ) : (
        <>
          <Select label="Novo horário fixo" value={chosen} onChange={p.onSlot} options={options} />
          {p.fullWarning && (
            <p className="mb-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              Esta turma está cheia. Se continuar, ela passa a ter um aluno a mais do que a capacidade.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={p.busy || !chosen}
              onClick={() => p.onAdd(chosen, p.fullWarning)}
              className="flex-1 rounded-lg bg-linear-to-r from-brand to-violet px-4 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              {p.busy ? "Adicionando…" : p.fullWarning ? "Adicionar mesmo assim" : "Adicionar"}
            </button>
            <button type="button" disabled={p.busy} onClick={p.onClose} className={secondary}>
              Fechar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

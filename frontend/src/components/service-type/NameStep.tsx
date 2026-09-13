import {
  PLAN_RECURRENCE_LABELS,
  SERVICE_TYPE_NAME_EXAMPLES,
  type PlanRecurrence,
} from '@service-center/shared';
import type { NameStepValue } from './types';

export interface NameStepProps {
  value: NameStepValue;
  onChange: (value: NameStepValue) => void;
}

export const NameStep = ({ value, onChange }: NameStepProps) => (
  <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Add a Service Type</h1>
      <p className="mt-3 text-slate-600">
        A Service Type is a type of service that happens at your church. They usually recur weekly
        and are named using the main name you communicate to your congregation.
      </p>
    </div>

    <div>
      <h2 className="mb-2 text-lg text-slate-700">Examples</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-6 sm:grid-cols-3">
        {SERVICE_TYPE_NAME_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onChange({ ...value, name: example })}
            className="rounded-lg py-1 text-center text-slate-600 transition hover:bg-white hover:text-brand-700"
          >
            {example}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">Pick one to fill in the name, then edit it freely.</p>
    </div>

    <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
      <div>
        <label className="label text-base" htmlFor="service-type-name">
          What is your Service Type name?
        </label>
        <input
          id="service-type-name"
          className="input"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="Main Service"
          maxLength={120}
          autoFocus
          required
        />
      </div>
      <div>
        <label className="label text-base" htmlFor="service-type-recurrence">
          Plans recur
        </label>
        <select
          id="service-type-recurrence"
          className="input sm:w-52"
          value={value.recurrence}
          onChange={(event) =>
            onChange({ ...value, recurrence: event.target.value as PlanRecurrence })
          }
        >
          {Object.entries(PLAN_RECURRENCE_LABELS).map(([recurrence, label]) => (
            <option key={recurrence} value={recurrence}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  </div>
);

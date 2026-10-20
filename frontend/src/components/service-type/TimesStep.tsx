import { Trans, useTranslation } from 'react-i18next';
import { Button } from '../ui';
import type { ServiceTimeDraft } from './types';

export interface TimesStepProps {
  serviceTypeName: string;
  times: ServiceTimeDraft[];
  onChange: (times: ServiceTimeDraft[]) => void;
}

const nextId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `time-${Math.random().toString(36).slice(2)}`;

/** A new row repeats the last one's date — the common case is two services the same morning. */
export const emptyServiceTime = (like?: ServiceTimeDraft): ServiceTimeDraft => ({
  id: nextId(),
  date: like?.date ?? '',
  from: like?.from ?? '10:00',
  to: like?.to ?? '12:00',
});

export const TimesStep = ({ serviceTypeName, times, onChange }: TimesStepProps) => {
  const { t } = useTranslation('teams');
  const update = (id: string, patch: Partial<ServiceTimeDraft>) =>
    onChange(times.map((time) => (time.id === id ? { ...time, ...patch } : time)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {t('timesStep.title')}
        </h1>
        <p className="mt-3 text-slate-600">
          <Trans
            t={t}
            i18nKey="timesStep.intro"
            values={{ name: serviceTypeName }}
            components={[<strong key="name" className="font-semibold" />]}
          />
        </p>
      </div>

      <ul className="space-y-2">
        {times.map((time, index) => (
          <li
            key={time.id}
            className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-3"
          >
            <input
              type="date"
              aria-label={t('timesStep.dateFor', { number: index + 1 })}
              className="input flex-1 sm:min-w-56"
              value={time.date}
              onChange={(event) => update(time.id, { date: event.target.value })}
              required
            />
            <span className="text-sm text-slate-500">{t('timesStep.from')}</span>
            <input
              type="time"
              aria-label={t('timesStep.startFor', { number: index + 1 })}
              className="input w-32"
              value={time.from}
              onChange={(event) => update(time.id, { from: event.target.value })}
              required
            />
            <span className="text-sm text-slate-500">{t('timesStep.to')}</span>
            <input
              type="time"
              aria-label={t('timesStep.endFor', { number: index + 1 })}
              className="input w-32"
              value={time.to}
              onChange={(event) => update(time.id, { to: event.target.value })}
              required
            />
            {times.length > 1 && (
              <button
                type="button"
                aria-label={t('timesStep.removeFor', { number: index + 1 })}
                onClick={() => onChange(times.filter((candidate) => candidate.id !== time.id))}
                className="px-1 text-lg text-slate-400 hover:text-rose-500"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex justify-center">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...times, emptyServiceTime(times.at(-1))])}
        >
          {t('timesStep.addAnother')}
        </Button>
      </div>

      <p className="text-center text-sm text-slate-400">
        {t('timesStep.footnote')}
      </p>
    </div>
  );
};

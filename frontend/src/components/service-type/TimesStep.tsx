import { Trans, useTranslation } from 'react-i18next';
import { Button, IconButton } from '../ui';
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
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">
          {t('timesStep.title')}
        </h1>
        <p className="mt-3 text-pretty text-slate-600 dark:text-slate-300">
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
            className="surface-inset flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4"
          >
            <input
              type="date"
              aria-label={t('timesStep.dateFor', { number: index + 1 })}
              className="input w-full sm:w-auto sm:min-w-56 sm:flex-1"
              value={time.date}
              onChange={(event) => update(time.id, { date: event.target.value })}
              required
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('timesStep.from')}</span>
            <input
              type="time"
              aria-label={t('timesStep.startFor', { number: index + 1 })}
              className="input w-32"
              value={time.from}
              onChange={(event) => update(time.id, { from: event.target.value })}
              required
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('timesStep.to')}</span>
            <input
              type="time"
              aria-label={t('timesStep.endFor', { number: index + 1 })}
              className="input w-32"
              value={time.to}
              onChange={(event) => update(time.id, { to: event.target.value })}
              required
            />
            {times.length > 1 && (
              <IconButton
                icon="close"
                size="sm"
                label={t('timesStep.removeFor', { number: index + 1 })}
                onClick={() => onChange(times.filter((candidate) => candidate.id !== time.id))}
                className="ml-auto hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400"
              />
            )}
          </li>
        ))}
      </ul>

      <div className="flex justify-center">
        <Button
          type="button"
          variant="secondary"
          icon="plus"
          onClick={() => onChange([...times, emptyServiceTime(times.at(-1))])}
        >
          {t('timesStep.addAnother')}
        </Button>
      </div>

      <p className="text-center text-sm text-slate-400 dark:text-slate-500">
        {t('timesStep.footnote')}
      </p>
    </div>
  );
};

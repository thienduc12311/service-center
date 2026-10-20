import { useTranslation } from 'react-i18next';
import type { PlanRecurrence } from '@service-center/shared';
import type { NameStepValue } from './types';

export interface NameStepProps {
  value: NameStepValue;
  onChange: (value: NameStepValue) => void;
}

/** Suggested names (`teams:nameStep.examples.*`), in the order they're shown. */
type NameExample =
  | 'weekend'
  | 'sunday'
  | 'specialEvents'
  | 'contemporary'
  | 'traditional'
  | 'recovery'
  | 'children'
  | 'highSchool'
  | 'middleSchool';

const NAME_EXAMPLES: readonly NameExample[] = [
  'weekend',
  'sunday',
  'specialEvents',
  'contemporary',
  'traditional',
  'recovery',
  'children',
  'highSchool',
  'middleSchool',
];

const RECURRENCES: readonly PlanRecurrence[] = ['weekly', 'biweekly', 'monthly', 'occasionally'];

export const NameStep = ({ value, onChange }: NameStepProps) => {
  const { t } = useTranslation('teams');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{t('nameStep.title')}</h1>
        <p className="mt-3 text-slate-600">
          {t('nameStep.intro')}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-lg text-slate-700">{t('nameStep.examplesTitle')}</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-6 sm:grid-cols-3">
          {NAME_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onChange({ ...value, name: t(`nameStep.examples.${example}`) })}
              className="rounded-lg py-1 text-center text-slate-600 transition hover:bg-white hover:text-brand-700"
            >
              {t(`nameStep.examples.${example}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">{t('nameStep.examplesHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="label text-base" htmlFor="service-type-name">
            {t('nameStep.nameLabel')}
          </label>
          <input
            id="service-type-name"
            className="input"
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            placeholder={t('nameStep.namePlaceholder')}
            maxLength={120}
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label text-base" htmlFor="service-type-recurrence">
            {t('nameStep.recurrenceLabel')}
          </label>
          <select
            id="service-type-recurrence"
            className="input sm:w-52"
            value={value.recurrence}
            onChange={(event) =>
              onChange({ ...value, recurrence: event.target.value as PlanRecurrence })
            }
          >
            {RECURRENCES.map((recurrence) => (
              <option key={recurrence} value={recurrence}>
                {t(`nameStep.recurrence.${recurrence}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

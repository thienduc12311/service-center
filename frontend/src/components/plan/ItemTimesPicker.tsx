import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanTimeRow } from '@service-center/shared';

/** A service time the item can be limited to. */
export type ItemTimeChoice = Pick<PlanTimeRow, 'id' | 'name' | 'starts_at'>;

/** Every service time, or only the chosen ones. */
export type ItemTimesMode = 'all' | 'some';

export interface ItemTimesPickerProps {
  /** The plan's service times, in start order. */
  times: readonly ItemTimeChoice[];
  mode: ItemTimesMode;
  onModeChange: (mode: ItemTimesMode) => void;
  selected: readonly string[];
  onSelectedChange: (ids: string[]) => void;
  /** "9am · 9:00", in the organization's zone. */
  describe: (time: ItemTimeChoice) => string;
}

/** "All service times" or a checklist of the plan's service times. */
export const ItemTimesPicker = ({ times, mode, onModeChange, selected, onSelectedChange, describe }: ItemTimesPickerProps) => {
  const { t } = useTranslation('plans');
  const name = useId();
  if (times.length === 0) {
    return (
      <fieldset>
        <legend className="label">{t('editItem.serviceTimes')}</legend>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('editItem.noServiceTimes')}</p>
      </fieldset>
    );
  }
  const toggle = (id: string, checked: boolean) =>
    onSelectedChange(checked ? [...new Set([...selected, id])] : selected.filter((other) => other !== id));
  return (
    <fieldset>
      <legend className="label">{t('editItem.serviceTimes')}</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        {(['all', 'some'] as const).map((value) => (
          <label key={value} className="flex items-center gap-1.5">
            <input type="radio" name={name} checked={mode === value} onChange={() => onModeChange(value)} />
            {t(value === 'all' ? 'editItem.allServiceTimes' : 'editItem.someServiceTimes')}
          </label>
        ))}
      </div>
      {mode === 'some' && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 pl-5 text-sm">
          {times.map((time) => (
            <label key={time.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={selected.includes(time.id)} onChange={(event) => toggle(time.id, event.target.checked)} />
              {describe(time)}
            </label>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('editItem.serviceTimesHint')}</p>
    </fieldset>
  );
};

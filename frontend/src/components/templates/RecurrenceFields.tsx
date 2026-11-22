import { useTranslation } from 'react-i18next';
import {
  MAX_GENERATED_PLANS,
  RECURRENCE_ORDINALS,
  ordinalOf,
  planSeriesSummaryText,
  weekdayNames,
  weekdayOf,
  type PlanSeriesEnd,
  type PlanSeriesRecurrence,
  type RecurrenceOrdinal,
} from '@service-center/shared';
import { useStructuredText } from '../../i18n';

type Frequency = PlanSeriesRecurrence['frequency'];
const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly_weekday', 'monthly_day'];
const FREQUENCY_LABEL = {
  weekly: 'generate.frequencyWeekly',
  monthly_weekday: 'generate.frequencyMonthlyWeekday',
  monthly_day: 'generate.frequencyMonthlyDay',
} as const;
const WEEK_INTERVALS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => index + 1);

export interface RecurrenceFieldsProps {
  /** The first date; weekly rules repeat from it, monthly rules start on or after it. */
  startDate: string;
  recurrence: PlanSeriesRecurrence;
  end: PlanSeriesEnd;
  onRecurrenceChange: (recurrence: PlanSeriesRecurrence) => void;
  onEndChange: (end: PlanSeriesEnd) => void;
  /** The service type the default came from, for the hint under the rule. */
  serviceTypeName?: string | null;
}

/** A rule of a new frequency, seeded from the first date ("2nd Sunday", "day 9"). */
export const recurrenceFor = (frequency: Frequency, startDate: string): PlanSeriesRecurrence => {
  switch (frequency) {
    case 'weekly':
      return { frequency: 'weekly', interval_weeks: 1 };
    case 'monthly_weekday':
      return { frequency: 'monthly_weekday', ordinal: ordinalOf(startDate), weekday: weekdayOf(startDate) };
    case 'monthly_day':
      return { frequency: 'monthly_day', day_of_month: Number(startDate.slice(8, 10)), short_month: 'skip' };
  }
};

/**
 * How generated plans repeat and when they stop: weekly every 1–8 weeks,
 * monthly on the Nth or last weekday, or monthly on a day of month (with an
 * explicit choice for days 29–31), ending after a count or on a date. The
 * rule is also said in words, as the preview will say it.
 */
export const RecurrenceFields = ({
  startDate,
  recurrence,
  end,
  onRecurrenceChange,
  onEndChange,
  serviceTypeName,
}: RecurrenceFieldsProps) => {
  const { t } = useTranslation('templates');
  const structured = useStructuredText();
  const weekdays = weekdayNames(structured.locale, 'long');
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="gen-frequency">{t('generate.frequencyLabel')}</label>
        <select
          id="gen-frequency"
          className="input"
          value={recurrence.frequency}
          onChange={(event) => onRecurrenceChange(recurrenceFor(event.target.value as Frequency, startDate))}
        >
          {FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{t(FREQUENCY_LABEL[frequency])}</option>)}
        </select>
        {serviceTypeName && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('generate.followsServiceType', { serviceType: serviceTypeName })}</p>}
      </div>

      {recurrence.frequency === 'weekly' && (
        <div>
          <label className="label" htmlFor="gen-interval">{t('generate.repeat')}</label>
          <select
            id="gen-interval"
            className="input"
            value={recurrence.interval_weeks}
            onChange={(event) => onRecurrenceChange({ frequency: 'weekly', interval_weeks: Number(event.target.value) })}
          >
            {WEEK_INTERVALS.map((weeks) => (
              <option key={weeks} value={weeks}>{weeks === 1 ? t('generate.everyWeek') : t('generate.everyNWeeks', { weeks })}</option>
            ))}
          </select>
        </div>
      )}

      {recurrence.frequency === 'monthly_weekday' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="label" htmlFor="gen-ordinal">{t('generate.weekOfMonth')}</label>
            <select
              id="gen-ordinal"
              className="input"
              value={recurrence.ordinal}
              onChange={(event) => onRecurrenceChange({ ...recurrence, ordinal: event.target.value as RecurrenceOrdinal })}
            >
              {RECURRENCE_ORDINALS.map((ordinal) => <option key={ordinal} value={ordinal}>{t(`recurrence.ordinal.${ordinal}`)}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="gen-weekday">{t('generate.weekday')}</label>
            <select
              id="gen-weekday"
              className="input"
              value={recurrence.weekday}
              onChange={(event) => onRecurrenceChange({ ...recurrence, weekday: Number(event.target.value) })}
            >
              {weekdays.map((name, weekday) => <option key={name} value={weekday}>{name}</option>)}
            </select>
          </div>
        </div>
      )}

      {recurrence.frequency === 'monthly_day' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="label" htmlFor="gen-day">{t('generate.dayOfMonth')}</label>
            <select
              id="gen-day"
              className="input"
              value={recurrence.day_of_month}
              onChange={(event) => onRecurrenceChange({ ...recurrence, day_of_month: Number(event.target.value) })}
            >
              {DAYS_OF_MONTH.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </div>
          {recurrence.day_of_month > 28 && (
            <div className="min-w-0">
              <label className="label" htmlFor="gen-short-month">{t('generate.shortMonthLabel')}</label>
              <select
                id="gen-short-month"
                className="input"
                value={recurrence.short_month}
                onChange={(event) => onRecurrenceChange({ ...recurrence, short_month: event.target.value === 'clamp' ? 'clamp' : 'skip' })}
              >
                <option value="skip">{t('generate.shortMonthSkip')}</option>
                <option value="clamp">{t('generate.shortMonthClamp')}</option>
              </select>
            </div>
          )}
        </div>
      )}

      <fieldset className="sm:col-span-2">
        <legend className="label">{t('generate.endsLabel')}</legend>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="gen-ends"
              className="accent-brand-600"
              checked={end.kind === 'count'}
              onChange={() => onEndChange({ kind: 'count', count: 4 })}
            />
            {t('generate.endsAfterCount')}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="gen-ends"
              className="accent-brand-600"
              checked={end.kind === 'until'}
              onChange={() => onEndChange({ kind: 'until', until_date: startDate })}
            />
            {t('generate.endsOnDate')}
          </label>
          {end.kind === 'count' ? (
            <div className="w-32">
              <label className="label" htmlFor="gen-count">{t('generate.howMany')}</label>
              <input
                id="gen-count"
                type="number"
                min={1}
                max={MAX_GENERATED_PLANS}
                className="input"
                value={end.count}
                onChange={(event) => onEndChange({ kind: 'count', count: Math.min(MAX_GENERATED_PLANS, Math.max(1, Number(event.target.value) || 1)) })}
              />
            </div>
          ) : (
            <div className="w-full sm:w-48">
              <label className="label" htmlFor="gen-end">{t('generate.lastDate')}</label>
              <input
                id="gen-end"
                type="date"
                className="input"
                min={startDate}
                value={end.until_date}
                onChange={(event) => onEndChange({ kind: 'until', until_date: event.target.value })}
              />
            </div>
          )}
        </div>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('generate.limitHint', { max: MAX_GENERATED_PLANS })}</p>
      </fieldset>

      {validStart && (end.kind === 'count' || end.until_date) && (
        <p className="text-sm font-medium text-slate-800 sm:col-span-2 dark:text-slate-100" data-testid="recurrence-summary">
          {planSeriesSummaryText(recurrence, startDate, end, structured)}
        </p>
      )}
    </div>
  );
};

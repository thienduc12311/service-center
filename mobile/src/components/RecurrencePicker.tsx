import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  MAX_GENERATED_PLANS,
  RECURRENCE_ORDINALS,
  planSeriesSummaryText,
  recurrenceForFrequency,
  weekdayNames,
  type PlanSeriesEnd,
  type PlanSeriesRecurrence,
} from '@service-center/shared';
import { Button, Chip, Field, Label, SegmentedControl, type SegmentOption } from './ui';
import { clampPlanCount } from '../lib/template-use';
import { type Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { useFormatters, useStructuredText } from '../i18n';

type Frequency = PlanSeriesRecurrence['frequency'];
type EndKind = PlanSeriesEnd['kind'];
const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly_weekday', 'monthly_day'];
const FREQUENCY_LABEL = {
  weekly: 'generate.frequencyWeekly',
  monthly_weekday: 'generate.frequencyMonthlyWeekday',
  monthly_day: 'generate.frequencyMonthlyDay',
} as const;
const WEEK_INTERVALS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export interface RecurrencePickerProps {
  startDate: string;
  recurrence: PlanSeriesRecurrence;
  end: PlanSeriesEnd;
  /** Text typed into the count field, kept by the screen so it can be mid-edit. */
  countText: string;
  onCountTextChange: (text: string) => void;
  onRecurrenceChange: (recurrence: PlanSeriesRecurrence) => void;
  onEndChange: (end: PlanSeriesEnd) => void;
  /** Opens the date picker for the last date. */
  onPickLastDate: () => void;
  /** The service type the default came from, while the rule is still the default. */
  serviceTypeName?: string | null;
}

/**
 * The website's recurrence choices in native controls: weekly every 1–8
 * weeks, monthly on the Nth/last weekday or on a day of month (days 29–31
 * skip or clamp), ending after a count or on a date — said in words below.
 */
export const RecurrencePicker = ({
  startDate,
  recurrence,
  end,
  countText,
  onCountTextChange,
  onRecurrenceChange,
  onEndChange,
  onPickLastDate,
  serviceTypeName,
}: RecurrencePickerProps) => {
  const { t } = useTranslation(['templates', 'plans']);
  const format = useFormatters();
  const structured = useStructuredText();
  const styles = useThemedStyles(makeStyles);
  const weekdays = weekdayNames(structured.locale, 'short');

  const frequencyOptions = useMemo<readonly SegmentOption<Frequency>[]>(
    () => FREQUENCIES.map((value) => ({ value, label: t(FREQUENCY_LABEL[value]) })),
    [t],
  );
  const endOptions = useMemo<readonly SegmentOption<EndKind>[]>(
    () => [
      { value: 'count', label: t('generate.endsAfterCount') },
      { value: 'until', label: t('generate.endsOnDate') },
    ],
    [t],
  );
  const shortMonthOptions = useMemo<readonly SegmentOption<'skip' | 'clamp'>[]>(
    () => [
      { value: 'skip', label: t('generate.shortMonthSkip') },
      { value: 'clamp', label: t('generate.shortMonthClamp') },
    ],
    [t],
  );

  return (
    <View style={styles.group}>
      <Label>{t('generate.frequencyLabel')}</Label>
      <SegmentedControl
        options={frequencyOptions}
        value={recurrence.frequency}
        onChange={(value) => onRecurrenceChange(recurrenceForFrequency(value, startDate))}
      />
      {serviceTypeName ? <Text style={styles.hint}>{t('generate.followsServiceType', { serviceType: serviceTypeName })}</Text> : null}

      {recurrence.frequency === 'weekly' ? (
        <View style={styles.chips}>
          {WEEK_INTERVALS.map((weeks) => (
            <Chip
              key={weeks}
              label={weeks === 1 ? t('generate.everyWeek') : t('generate.everyNWeeks', { weeks })}
              active={recurrence.interval_weeks === weeks}
              onPress={() => onRecurrenceChange({ frequency: 'weekly', interval_weeks: weeks })}
            />
          ))}
        </View>
      ) : null}

      {recurrence.frequency === 'monthly_weekday' ? (
        <>
          <Label>{t('generate.weekOfMonth')}</Label>
          <View style={styles.chips}>
            {RECURRENCE_ORDINALS.map((ordinal) => (
              <Chip
                key={ordinal}
                label={t(`recurrence.ordinal.${ordinal}`)}
                active={recurrence.ordinal === ordinal}
                onPress={() => onRecurrenceChange({ ...recurrence, ordinal })}
              />
            ))}
          </View>
          <Label>{t('generate.weekday')}</Label>
          <View style={styles.chips}>
            {weekdays.map((name, weekday) => (
              <Chip
                key={name}
                label={name}
                active={recurrence.weekday === weekday}
                onPress={() => onRecurrenceChange({ ...recurrence, weekday })}
              />
            ))}
          </View>
        </>
      ) : null}

      {recurrence.frequency === 'monthly_day' ? (
        <>
          <Field
            label={t('generate.dayOfMonth')}
            value={String(recurrence.day_of_month)}
            keyboardType="number-pad"
            maxLength={2}
            onChangeText={(value) => {
              const day = Number(value);
              if (Number.isInteger(day) && day >= 1 && day <= 31) onRecurrenceChange({ ...recurrence, day_of_month: day });
            }}
          />
          {recurrence.day_of_month > 28 ? (
            <>
              <Label>{t('generate.shortMonthLabel')}</Label>
              <SegmentedControl
                options={shortMonthOptions}
                value={recurrence.short_month}
                onChange={(value) => onRecurrenceChange({ ...recurrence, short_month: value })}
              />
            </>
          ) : null}
        </>
      ) : null}

      <Label>{t('generate.endsLabel')}</Label>
      <SegmentedControl
        options={endOptions}
        value={end.kind}
        onChange={(value) => onEndChange(value === 'count'
          ? { kind: 'count', count: clampPlanCount(Number(countText), MAX_GENERATED_PLANS) }
          : { kind: 'until', until_date: startDate })}
      />
      {end.kind === 'count' ? (
        <Field
          label={t('generate.howMany')}
          value={countText}
          keyboardType="number-pad"
          maxLength={2}
          onChangeText={(value) => {
            onCountTextChange(value);
            onEndChange({ kind: 'count', count: clampPlanCount(Number(value), MAX_GENERATED_PLANS) });
          }}
          onEndEditing={() => onCountTextChange(String(end.count))}
        />
      ) : (
        <Button
          title={t('plans:mobileGenerate.lastDateButton', { date: format.calendarDate(end.until_date, 'medium') })}
          variant="secondary"
          onPress={onPickLastDate}
        />
      )}
      <Text style={styles.hint}>{t('generate.limitHint', { max: MAX_GENERATED_PLANS })}</Text>
      <Text style={styles.summary}>{planSeriesSummaryText(recurrence, startDate, end, structured)}</Text>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    group: { gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    summary: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
  });

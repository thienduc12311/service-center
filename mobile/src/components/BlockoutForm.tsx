import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation } from '@tanstack/react-query';
import {
  addLocalDays, resolveOneOffBlockout, type AffectedAssignmentPreview, type BlockoutRow,
  type PreviewBlockoutSeriesInput,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import type { Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { Button, ErrorNotice, Field, SegmentedControl, type SegmentOption } from './ui';

interface BlockoutFormProps {
  editing?: BlockoutRow | null;
  onSaved: () => Promise<void>;
  onCancelEdit?: () => void;
}

type Repeat = 'none' | 'weekly' | 'monthly';
type EndKind = 'count' | 'until';
type PickerTarget = 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'untilDate';

const REPEATS: readonly SegmentOption<Repeat>[] = [
  { value: 'none', label: 'Once' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' },
];
const END_KINDS: readonly SegmentOption<EndKind>[] = [
  { value: 'count', label: 'After' }, { value: 'until', label: 'Until' },
];
const AMBIGUOUS_POLICIES: readonly SegmentOption<'earlier' | 'later'>[] = [
  { value: 'earlier', label: 'Earlier' }, { value: 'later', label: 'Later' },
];
const pad = (value: number): string => String(value).padStart(2, '0');
const civilDate = (value: Date): string => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const civilTime = (value: Date): string => `${pad(value.getHours())}:${pad(value.getMinutes())}`;
const dateForPicker = (date: string, time = '12:00'): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year!, month! - 1, day!, hour!, minute!);
};
const initialDate = (): string => civilDate(new Date());
const newIdempotencyKey = (): string => globalThis.crypto?.randomUUID?.()
  ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });

export const BlockoutForm = ({ editing = null, onSaved, onCancelEdit }: BlockoutFormProps) => {
  const { user, organizationId, generation, isCurrentGeneration } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const timezone = user?.memberships.find((item) => item.organization.id === organizationId)?.organization.timezone ?? 'UTC';
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(initialDate());
  const [endDate, setEndDate] = useState(addLocalDays(initialDate(), 1));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [endKind, setEndKind] = useState<EndKind>('count');
  const [countText, setCountText] = useState('4');
  const [untilDate, setUntilDate] = useState(addLocalDays(initialDate(), 28));
  const [ambiguousPolicy, setAmbiguousPolicy] = useState<'earlier' | 'later'>('earlier');
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [affected, setAffected] = useState<AffectedAssignmentPreview[] | null>(null);
  const [occurrenceLabels, setOccurrenceLabels] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<Error | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!editing) return;
    setAllDay(editing.all_day); setStartDate(editing.local_start_date ?? editing.starts_at.slice(0, 10));
    setEndDate(editing.local_end_date ?? editing.ends_at.slice(0, 10));
    setStartTime(editing.local_start_time?.slice(0, 5) ?? '09:00');
    setEndTime(editing.local_end_time?.slice(0, 5) ?? '17:00'); setReason(editing.reason ?? '');
    setRepeat('none'); setAffected(null);
  }, [editing]);

  const intent = () => ({
    all_day: allDay, timezone, local_start_date: startDate,
    local_start_time: allDay ? null : startTime, local_end_date: endDate,
    local_end_time: allDay ? null : endTime, ambiguous_time_policy: ambiguousPolicy,
    reason: reason.trim() || null,
  });
  const series = (): PreviewBlockoutSeriesInput => ({ ...intent(), recurrence: {
    frequency: repeat === 'monthly' ? 'monthly' : 'weekly', interval: 1,
    end: endKind === 'count'
      ? { type: 'count', count: Number(countText) }
      : { type: 'until', until_date: untilDate },
    monthly_missing_date: 'skip',
  } });

  const review = useMutation({
    mutationFn: async () => {
      if (repeat !== 'none') return api.previewBlockoutSeries(series());
      const resolved = resolveOneOffBlockout({
        allDay, timeZone: timezone, localStartDate: startDate, localStartTime: allDay ? null : startTime,
        localEndDate: endDate, localEndTime: allDay ? null : endTime, ambiguousTimePolicy: ambiguousPolicy,
      });
      return { occurrences: [], affected_assignments: await api.previewAffectedAssignments({
        occurrences: [{ starts_at: resolved.startsAt, ends_at: resolved.endsAt }],
      }) };
    },
    onSuccess: (result) => {
      if (!isCurrentGeneration(generation)) return;
      setAffected(result.affected_assignments);
      setOccurrenceLabels(result.occurrences.slice(0, 8).map((item) => `${item.local_start_date}${item.local_start_time ? ` · ${item.local_start_time}` : ' · all day'}`));
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (editing) return api.updateBlockout(editing.id, { ...intent(), expected_revision: editing.revision });
      if (repeat === 'none') return api.createBlockout({ ...intent(), idempotency_key: idempotencyKey });
      return api.createBlockoutSeries({ ...series(), idempotency_key: idempotencyKey });
    },
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      setReason(''); setAffected(null); setOccurrenceLabels([]); setIdempotencyKey(newIdempotencyKey());
      await onSaved();
    },
  });

  const pickerValue = useMemo(() => {
    switch (picker) {
      case 'startDate': return dateForPicker(startDate);
      case 'endDate': return dateForPicker(endDate);
      case 'untilDate': return dateForPicker(untilDate);
      case 'startTime': return dateForPicker(startDate, startTime);
      case 'endTime': return dateForPicker(endDate, endTime);
      default: return new Date();
    }
  }, [picker, startDate, endDate, untilDate, startTime, endTime]);
  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || !value || !picker) return;
    if (picker === 'startDate') { const next = civilDate(value); setStartDate(next); if (allDay) setEndDate(addLocalDays(next, 1)); }
    else if (picker === 'endDate') setEndDate(civilDate(value));
    else if (picker === 'untilDate') setUntilDate(civilDate(value));
    else if (picker === 'startTime') setStartTime(civilTime(value));
    else setEndTime(civilTime(value));
    setAffected(null);
  };

  const submitReview = () => {
    try { if (repeat !== 'none' && endKind === 'count' && (!Number.isInteger(Number(countText)) || Number(countText) < 1 || Number(countText) > 120)) throw new Error('Choose 1 to 120 occurrences.'); setValidationError(null); review.mutate(); }
    catch (error) { setValidationError(error instanceof Error ? error : new Error('Check the blockout details.')); }
  };

  return <View style={styles.form}>
    <Text style={styles.description}>Organization timezone: {timezone}. Existing assignments are reviewed, never declined automatically.</Text>
    <View style={styles.switchRow}><Text style={styles.label}>All day</Text><Switch value={allDay} onValueChange={(value) => { setAllDay(value); setAffected(null); }} /></View>
    <View style={styles.row}><Button title={`Start · ${startDate}`} variant="secondary" onPress={() => setPicker('startDate')} /><Button title={`End · ${endDate}`} variant="secondary" onPress={() => setPicker('endDate')} /></View>
    {!allDay ? <View style={styles.row}><Button title={`From · ${startTime}`} variant="secondary" onPress={() => setPicker('startTime')} /><Button title={`To · ${endTime}`} variant="secondary" onPress={() => setPicker('endTime')} /></View> : <Text style={styles.hint}>End date is exclusive: a one-day blockout ends at the following local midnight.</Text>}
    {!allDay ? <><Text style={styles.label}>If the clock repeats this time</Text><SegmentedControl options={AMBIGUOUS_POLICIES} value={ambiguousPolicy} onChange={setAmbiguousPolicy} /><Text style={styles.hint}>A time skipped when the clock moves forward is rejected.</Text></> : null}
    {!editing ? <><Text style={styles.label}>Repeat</Text><SegmentedControl options={REPEATS} value={repeat} onChange={(value) => { setRepeat(value); setAffected(null); }} />{repeat !== 'none' ? <><Text style={styles.label}>Ends</Text><SegmentedControl options={END_KINDS} value={endKind} onChange={setEndKind} />{endKind === 'count' ? <Field label="Occurrences" value={countText} keyboardType="number-pad" onChangeText={setCountText} /> : <Button title={`Until · ${untilDate}`} variant="secondary" onPress={() => setPicker('untilDate')} />}<Text style={styles.hint}>Monthly dates missing from a month are skipped.</Text></> : null}</> : null}
    <Field label="Reason (private)" value={reason} onChangeText={(value) => { setReason(value); setAffected(null); }} placeholder="Away for a wedding" maxLength={200} />
    {picker ? <DateTimePicker value={pickerValue} mode={picker.includes('Time') ? 'time' : 'date'} display={Platform.OS === 'ios' ? 'inline' : 'default'} timeZoneName={timezone} onChange={onPickerChange} /> : null}
    <ErrorNotice error={validationError ?? review.error ?? save.error} />
    <Button title="Review blockout" variant="secondary" onPress={submitReview} loading={review.isPending} disabled={save.isPending} />
    {affected ? <View style={styles.review}><Text style={styles.label}>Review</Text>{occurrenceLabels.map((label) => <Text key={label} style={styles.hint}>{label}</Text>)}<Text style={styles.description}>{affected.length ? `${affected.length} existing commitment time(s) overlap. Their answers will stay unchanged.` : 'No existing commitments overlap.'}</Text>{affected.map((item) => <Text key={`${item.assignment_id}:${item.time_id}`} style={styles.commitment}>{item.plan_title} · {item.time_name ?? item.time_kind ?? 'service'}</Text>)}<Button title={editing ? 'Save changes' : repeat === 'none' ? 'Save blockout' : 'Create series'} onPress={() => save.mutate()} loading={save.isPending} disabled={review.isPending} /></View> : null}
    {editing && onCancelEdit ? <Button title="Cancel edit" variant="quiet" onPress={onCancelEdit} /> : null}
  </View>;
};

const makeStyles = (theme: Theme) => StyleSheet.create({
  form: { gap: theme.space.md }, description: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  hint: { ...theme.type.bodySmall, color: theme.color.inkFaint }, label: { ...theme.type.label, color: theme.color.ink },
  row: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  review: { gap: theme.space.sm, padding: theme.space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border, borderRadius: theme.radius.md },
  commitment: { ...theme.type.bodySmall, color: theme.color.ink },
});

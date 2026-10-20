import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addLocalDays, resolveOneOffBlockout, type BlockoutRow, type PreviewBlockoutSeriesInput } from '@service-center/shared';
import { AffectedCommitments } from './AffectedCommitments';
import { api } from '../../lib/api';
import { useBlockouts, useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Loading } from '../ui';
import { useFormatters } from '../../i18n';

interface AvailabilitySettingsProps {
  timezone: string;
  /** Someone else's availability (scheduler or explicit F03 delegate); omitted for your own. */
  personId?: string;
  /** Shown in the heading when managing someone else. */
  personName?: string;
}
type Repeat = 'none' | 'weekly' | 'monthly';
type EndKind = 'count' | 'until';

const today = (): string => new Date().toISOString().slice(0, 10);

export const AvailabilitySettings = ({ timezone, personId, personName }: AvailabilitySettingsProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { calendarDate } = useFormatters();
  const invalidate = useInvalidateOrg();
  const blockouts = useBlockouts(personId ? { scope: 'mine', person_id: personId } : { scope: 'mine' });
  const forSomeoneElse = Boolean(personId);
  const [editing, setEditing] = useState<BlockoutRow | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(addLocalDays(today(), 1));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [endKind, setEndKind] = useState<EndKind>('count');
  const [count, setCount] = useState(4);
  const [untilDate, setUntilDate] = useState(addLocalDays(today(), 28));
  const [ambiguousPolicy, setAmbiguousPolicy] = useState<'earlier' | 'later'>('earlier');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewBlockoutSeries>> | null>(null);

  const intent = () => ({
    ...(personId ? { person_id: personId } : {}),
    all_day: allDay, timezone, local_start_date: startDate,
    local_start_time: allDay ? null : startTime, local_end_date: endDate,
    local_end_time: allDay ? null : endTime, ambiguous_time_policy: ambiguousPolicy,
    reason: reason.trim() || null,
  });
  const series = (): PreviewBlockoutSeriesInput => ({
    ...intent(), recurrence: {
      frequency: repeat === 'monthly' ? 'monthly' : 'weekly', interval: 1,
      end: endKind === 'count' ? { type: 'count', count } : { type: 'until', until_date: untilDate },
      monthly_missing_date: 'skip',
    },
  });

  const reset = () => { setEditing(null); setReason(''); setPreview(null); };
  const previewMutation = useMutation({
    mutationFn: async () => repeat === 'none'
      ? { occurrences: [], affected_assignments: await api.previewAffectedAssignments({ ...(personId ? { person_id: personId } : {}), occurrences: [(() => {
          const resolved = resolveOneOffBlockout({
            allDay, timeZone: timezone, localStartDate: startDate, localStartTime: allDay ? null : startTime,
            localEndDate: endDate, localEndTime: allDay ? null : endTime, ambiguousTimePolicy: 'earlier',
          });
          return { starts_at: resolved.startsAt, ends_at: resolved.endsAt };
        })()] }) }
      : api.previewBlockoutSeries(series()),
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (editing) return api.updateBlockout(editing.id, { ...intent(), expected_revision: editing.revision });
      if (repeat === 'none') return api.createBlockout({ ...intent(), idempotency_key: crypto.randomUUID() });
      return api.createBlockoutSeries({ ...series(), idempotency_key: crypto.randomUUID() });
    },
    onSuccess: async () => { await invalidate(); reset(); },
  });
  const remove = useMutation({
    mutationFn: (row: BlockoutRow) => api.deleteBlockout(row.id, row.revision),
    onSuccess: invalidate,
  });

  const seriesRows = useMemo(() => {
    const groups = new Map<string, BlockoutRow>();
    for (const row of blockouts.data ?? []) if (row.series_id && !groups.has(row.series_id)) groups.set(row.series_id, row);
    return [...groups.values()];
  }, [blockouts.data]);
  const oneOffs = (blockouts.data ?? []).filter((row) => !row.series_id);

  const beginEdit = (row: BlockoutRow) => {
    setEditing(row); setAllDay(row.all_day); setStartDate(row.local_start_date ?? row.starts_at.slice(0, 10));
    setEndDate(row.local_end_date ?? row.ends_at.slice(0, 10)); setStartTime(row.local_start_time?.slice(0, 5) ?? '09:00');
    setEndTime(row.local_end_time?.slice(0, 5) ?? '17:00'); setReason(row.reason ?? ''); setRepeat('none');
  };

  return <section id={forSomeoneElse ? undefined : 'availability'} className="card scroll-mt-20 p-5">
    <h2 className="mb-1 font-semibold">{forSomeoneElse ? (personName ? t('blockouts.titleFor', { name: personName }) : t('blockouts.titleTheirs')) : t('blockouts.title')}</h2>
    <p className="mb-4 text-sm text-slate-500">{t(forSomeoneElse ? 'blockouts.descriptionTheirs' : 'blockouts.description', { timezone })}</p>
    <form className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />{t('blockouts.allDay')}</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">{t('blockouts.startDate')}<input className="input mt-1" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (allDay) setEndDate(addLocalDays(e.target.value, 1)); }} /></label>
        <label className="label">{allDay ? t('blockouts.endDateExclusive') : t('blockouts.endDate')}<input className="input mt-1" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        {!allDay && <><label className="label">{t('blockouts.startTime')}<input className="input mt-1" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label><label className="label">{t('blockouts.endTime')}<input className="input mt-1" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label></>}
      </div>
      {!editing && <div className="grid gap-3 sm:grid-cols-2"><label className="label">{t('blockouts.repeat')}<select className="input mt-1" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}><option value="none">{t('blockouts.repeatOptions.none')}</option><option value="weekly">{t('blockouts.repeatOptions.weekly')}</option><option value="monthly">{t('blockouts.repeatOptions.monthly')}</option></select></label>{repeat !== 'none' && <label className="label">{t('blockouts.ends')}<select className="input mt-1" value={endKind} onChange={(e) => setEndKind(e.target.value as EndKind)}><option value="count">{t('blockouts.endOptions.count')}</option><option value="until">{t('blockouts.endOptions.until')}</option></select></label>}</div>}
      {repeat !== 'none' && !editing && (endKind === 'count' ? <label className="label">{t('blockouts.occurrences')}<input className="input mt-1" type="number" min={1} max={120} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label> : <label className="label">{t('blockouts.until')}<input className="input mt-1" type="date" min={startDate} value={untilDate} onChange={(e) => setUntilDate(e.target.value)} /></label>)}
      <label className="label">{t('blockouts.reason')} <span className="font-normal text-slate-400">{t('blockouts.private')}</span><input className="input mt-1" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
      {!allDay && <label className="label">{t('blockouts.ambiguous')}<select className="input mt-1" value={ambiguousPolicy} onChange={(e) => setAmbiguousPolicy(e.target.value as 'earlier' | 'later')}><option value="earlier">{t('blockouts.ambiguousOptions.earlier')}</option><option value="later">{t('blockouts.ambiguousOptions.later')}</option></select></label>}
      <p className="text-xs text-slate-500">{t('blockouts.clockHint')}</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>{t('common:actions.preview')}</Button><Button type="submit" loading={save.isPending}>{editing ? t('common:actions.saveChanges') : t('blockouts.save')}</Button>{editing && <Button type="button" variant="ghost" onClick={reset}>{t('common:actions.cancel')}</Button>}</div>
      <ErrorNotice error={previewMutation.error ?? save.error} />
    </form>
    {preview && <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm"><p className="font-medium">{t('common:actions.preview')}</p>{preview.occurrences.slice(0, 8).map((item) => <p key={item.occurrence_key}>{item.local_start_time ? t('blockouts.occurrenceAt', { date: calendarDate(item.local_start_date), time: item.local_start_time }) : t('blockouts.occurrenceAllDay', { date: calendarDate(item.local_start_date) })}</p>)}<AffectedCommitments rows={preview.affected_assignments} canDecline={!forSomeoneElse} onChanged={invalidate} /></div>}
    <div className="mt-6 divide-y divide-slate-100">{blockouts.isLoading ? <Loading /> : null}{oneOffs.map((row) => <div key={row.id} className="flex items-center gap-3 py-3"><div className="flex-1 text-sm"><p className="font-medium">{row.all_day ? t('blockouts.occurrenceAllDay', { date: calendarDate(row.local_start_date ?? row.starts_at.slice(0, 10)) }) : t('blockouts.rowTimes', { date: calendarDate(row.local_start_date ?? row.starts_at.slice(0, 10)), start: row.local_start_time?.slice(0, 5) ?? '', end: row.local_end_time?.slice(0, 5) ?? '' })}</p>{row.reason && <p className="text-xs text-slate-500">{row.reason}</p>}</div><Button variant="ghost" onClick={() => beginEdit(row)}>{t('common:actions.edit')}</Button><Button variant="ghost" onClick={() => remove.mutate(row)}>{t('common:actions.remove')}</Button></div>)}{seriesRows.map((row) => <div key={row.series_id} className="flex items-center gap-3 py-3"><div className="flex-1 text-sm"><p className="font-medium">{t('blockouts.repeatingFrom', { date: row.local_start_date ? calendarDate(row.local_start_date) : '' })}</p><p className="text-xs text-slate-500">{t('blockouts.seriesHint')}</p></div>{!forSomeoneElse && <Link className="button button-secondary" to={`/settings/blockouts/${row.series_id}`}>{t('blockouts.manageSeries')}</Link>
}</div>)}</div>
    <ErrorNotice error={blockouts.error ?? remove.error} />
  </section>;
};

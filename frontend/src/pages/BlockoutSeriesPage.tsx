import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { MaintainBlockoutSeriesInput, PreviewBlockoutSeriesInput } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { keys } from '../hooks/queries';

type Scope = 'occurrence' | 'future' | 'series';

export const BlockoutSeriesPage = () => {
  const { seriesId } = useParams();
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...keys.blockouts(organizationId, { scope: 'mine' }), 'series', seriesId],
    queryFn: () => api.getBlockoutSeries(seriesId!), enabled: Boolean(organizationId && seriesId),
  });
  const [scope, setScope] = useState<Scope>('occurrence');
  const [occurrenceId, setOccurrenceId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState('');
  const rows = useMemo(() => query.data?.occurrences ?? [], [query.data]);

  useEffect(() => {
    const first = rows[0]; const series = query.data?.series;
    if (!first || !series || occurrenceId) return;
    setOccurrenceId((query.data as unknown as { occurrences: Array<{ id?: string }> }).occurrences[0]?.id ?? '');
    setStartDate(first.local_start_date); setEndDate(first.local_end_date);
    setStartTime(first.local_start_time?.slice(0, 5) ?? '09:00'); setEndTime(first.local_end_time?.slice(0, 5) ?? '17:00');
    setReason(series.reason ?? '');
  }, [rows, query.data, occurrenceId]);

  const actualRows = useQuery({
    queryKey: keys.blockouts(organizationId, { scope: 'mine' }),
    queryFn: () => api.listBlockouts({ scope: 'mine' }), enabled: Boolean(organizationId),
  });
  const seriesRows = (actualRows.data ?? []).filter((row) => row.series_id === seriesId);
  useEffect(() => { if (!occurrenceId && seriesRows[0]) setOccurrenceId(seriesRows[0].id); }, [occurrenceId, seriesRows]);

  const change = useMutation({
    mutationFn: (input: MaintainBlockoutSeriesInput) => api.changeBlockoutSeries(seriesId!, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.all(organizationId) });
      await query.refetch();
    },
  });
  const series = query.data?.series;
  const replacement = (): PreviewBlockoutSeriesInput => ({
    all_day: series!.all_day, timezone: series!.timezone, local_start_date: startDate,
    local_start_time: series!.all_day ? null : startTime, local_end_date: endDate,
    local_end_time: series!.all_day ? null : endTime, reason: reason.trim() || null,
    ambiguous_time_policy: series!.ambiguous_time_policy,
    recurrence: {
      frequency: series!.frequency, interval: series!.interval_count, monthly_missing_date: 'skip',
      end: series!.end_type === 'count'
        ? { type: 'count', count: scope === 'future'
            ? Math.max(1, series!.occurrence_count! - Math.max(0, seriesRows.findIndex((row) => row.id === occurrenceId)))
            : series!.occurrence_count! }
        : { type: 'until', until_date: series!.until_date! },
    },
  });
  const submitUpdate = (event: FormEvent) => {
    event.preventDefault(); if (!series) return;
    const common = { scope, expected_series_revision: series.revision, idempotency_key: crypto.randomUUID(), action: 'update' as const };
    if (scope === 'series') change.mutate({ ...common, scope, replacement: replacement() });
    else if (scope === 'future') change.mutate({ ...common, scope, occurrence_id: occurrenceId, replacement: replacement() });
    else change.mutate({ ...common, scope, occurrence_id: occurrenceId, replacement: {
      all_day: series.all_day, timezone: series.timezone, local_start_date: startDate,
      local_start_time: series.all_day ? null : startTime, local_end_date: endDate,
      local_end_time: series.all_day ? null : endTime, reason: reason.trim() || null,
      ambiguous_time_policy: series.ambiguous_time_policy,
    } });
  };
  const submitDelete = () => {
    if (!series) return;
    const common = { scope, expected_series_revision: series.revision, idempotency_key: crypto.randomUUID(), action: 'delete' as const };
    if (scope === 'series') change.mutate({ ...common, scope });
    else if (scope === 'future') change.mutate({ ...common, scope, occurrence_id: occurrenceId });
    else change.mutate({ ...common, scope, occurrence_id: occurrenceId });
  };

  if (query.isLoading || actualRows.isLoading) return <Loading />;
  if (!series) return <div className="space-y-4"><ErrorNotice error={query.error ?? new Error('Repeating blockout not found.')} /><Link to="/settings">Back to settings</Link></div>;

  return <div className="max-w-3xl space-y-6">
    <PageHeader title="Manage repeating blockout" subtitle={`${series.frequency === 'weekly' ? 'Weekly' : 'Monthly'} in ${series.timezone}`} />
    <Link className="text-sm text-brand-700 underline" to="/settings">← Back to settings</Link>
    <section className="card p-5"><form className="space-y-4" onSubmit={submitUpdate}>
      <label className="label">Change<select className="input mt-1" value={scope} onChange={(e) => setScope(e.target.value as Scope)}><option value="occurrence">This occurrence</option><option value="future">This and future occurrences</option><option value="series">Whole series</option></select></label>
      {scope !== 'series' && <label className="label">Occurrence<select className="input mt-1" value={occurrenceId} onChange={(e) => { const id = e.target.value; setOccurrenceId(id); const row = seriesRows.find((item) => item.id === id); if (row) { setStartDate(row.local_start_date!); setEndDate(row.local_end_date!); setStartTime(row.local_start_time?.slice(0,5) ?? '09:00'); setEndTime(row.local_end_time?.slice(0,5) ?? '17:00'); } }}>{seriesRows.map((row) => <option key={row.id} value={row.id}>{row.local_start_date}</option>)}</select></label>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="label">Start date<input className="input mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label className="label">End date {series.all_day && '(exclusive)'}<input className="input mt-1" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>{!series.all_day && <><label className="label">Start time<input className="input mt-1" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label><label className="label">End time<input className="input mt-1" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label></>}</div>
      <label className="label">Reason<input className="input mt-1" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={change.isPending}>Save {scope === 'series' ? 'series' : 'change'}</Button><Button type="button" variant="danger" loading={change.isPending} onClick={submitDelete}>Delete {scope === 'occurrence' ? 'occurrence' : scope === 'future' ? 'this and future' : 'series'}</Button></div>
      <ErrorNotice error={change.error} />
    </form></section>
    <section className="card p-5"><h2 className="mb-3 font-semibold">Saved occurrences</h2><ul className="divide-y divide-slate-100">{seriesRows.map((row) => <li key={row.id} className="py-2 text-sm">{row.local_start_date}{row.all_day ? ' · all day' : ` · ${row.local_start_time?.slice(0,5)}–${row.local_end_time?.slice(0,5)}`}</li>)}</ul></section>
  </div>;
};

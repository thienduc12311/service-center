import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { LocalizedError, type MaintainBlockoutSeriesInput, type PreviewBlockoutSeriesInput } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { keys } from '../hooks/queries';
import { useFormatters } from '../i18n';

type Scope = 'occurrence' | 'future' | 'series';

export const BlockoutSeriesPage = () => {
  const { seriesId } = useParams();
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation('scheduling');
  const f = useFormatters();
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
  if (!series) return <div className="space-y-4"><ErrorNotice error={query.error ?? new LocalizedError({ key: 'scheduling:blockoutSeries.notFound' })} /><Link to="/settings">{t('blockoutSeries.backToSettings')}</Link></div>;

  return <div className="max-w-3xl space-y-6">
    <PageHeader title={t('blockoutSeries.title')} subtitle={t(`blockoutSeries.subtitle.${series.frequency}`, { timezone: series.timezone })} />
    <Link className="text-sm text-brand-700 underline" to="/settings">{t('blockoutSeries.backToSettingsArrow')}</Link>
    <section className="card p-5"><form className="space-y-4" onSubmit={submitUpdate}>
      <label className="label">{t('blockoutSeries.changeLabel')}<select className="input mt-1" value={scope} onChange={(e) => setScope(e.target.value as Scope)}><option value="occurrence">{t('blockoutSeries.scope.occurrence')}</option><option value="future">{t('blockoutSeries.scope.future')}</option><option value="series">{t('blockoutSeries.scope.series')}</option></select></label>
      {scope !== 'series' && <label className="label">{t('blockoutSeries.occurrenceLabel')}<select className="input mt-1" value={occurrenceId} onChange={(e) => { const id = e.target.value; setOccurrenceId(id); const row = seriesRows.find((item) => item.id === id); if (row) { setStartDate(row.local_start_date!); setEndDate(row.local_end_date!); setStartTime(row.local_start_time?.slice(0,5) ?? '09:00'); setEndTime(row.local_end_time?.slice(0,5) ?? '17:00'); } }}>{seriesRows.map((row) => <option key={row.id} value={row.id}>{row.local_start_date ? f.calendarDate(row.local_start_date, 'medium') : ''}</option>)}</select></label>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="label">{t('blockoutSeries.startDate')}<input className="input mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label className="label">{series.all_day ? t('blockoutSeries.endDateExclusive') : t('blockoutSeries.endDate')}<input className="input mt-1" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>{!series.all_day && <><label className="label">{t('blockoutSeries.startTime')}<input className="input mt-1" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label><label className="label">{t('blockoutSeries.endTime')}<input className="input mt-1" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label></>}</div>
      <label className="label">{t('blockoutSeries.reason')}<input className="input mt-1" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={change.isPending}>{t(`blockoutSeries.save.${scope}`)}</Button><Button type="button" variant="danger" loading={change.isPending} onClick={submitDelete}>{t(`blockoutSeries.delete.${scope}`)}</Button></div>
      <ErrorNotice error={change.error} />
    </form></section>
    <section className="card p-5"><h2 className="mb-3 font-semibold">{t('blockoutSeries.savedOccurrences')}</h2><ul className="divide-y divide-slate-100">{seriesRows.map((row) => <li key={row.id} className="py-2 text-sm">{row.all_day
      ? t('blockoutSeries.occurrenceAllDay', { date: row.local_start_date ? f.calendarDate(row.local_start_date, 'medium') : '' })
      : t('blockoutSeries.occurrenceTimed', { date: row.local_start_date ? f.calendarDate(row.local_start_date, 'medium') : '', start: row.local_start_time?.slice(0, 5) ?? '', end: row.local_end_time?.slice(0, 5) ?? '' })}</li>)}</ul></section>
  </div>;
};

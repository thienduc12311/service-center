import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  REPORT_EXPORT_STATUS_ACCENTS,
  canRebuildReportExport,
  defaultReportFilters,
  planReportFilters,
  reportExportErrorKey,
  reportExportStatusAt,
  reportExportsInProgress,
  type ReportExportSummary,
  type ReportFiltersRequest,
  type ScheduleReport,
  type ScheduleReportRow,
} from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import { newIdempotencyKey } from '../src/lib/idempotency';
import { civilDate, dateForPicker } from '../src/lib/civil-date';
import {
  reportCsvFilename,
  reportRangeInOrder,
  shareOutcome,
  type ShareOutcome,
} from '../src/lib/calendar-sharing';
import { useScreenVisible } from '../src/lib/useScreenVisible';
import { useAuth } from '../src/providers/AuthProvider';
import { useFormatters } from '../src/i18n';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorNotice,
  Label,
  Loading,
  Meta,
  Screen,
  Tag,
  screenPadding,
} from '../src/components/ui';
import { statusAccent, type Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

/** How often the exports list is re-read while one is queued or building (the website's interval). */
const EXPORT_POLL_MS = 5000;

type DateField = 'from' | 'to';

/** Search params a plan workspace passes to open this report on its day and service type. */
type ScheduleReportParams = {
  date?: string;
  serviceTypeId?: string;
};

/** One plan's rows, in the server's order. */
interface ReportPlanGroup {
  planId: string;
  title: string;
  serviceDate: string;
  serviceType: string | null;
  rows: ScheduleReportRow[];
}

const groupByPlan = (rows: readonly ScheduleReportRow[]): ReportPlanGroup[] => {
  const groups = new Map<string, ReportPlanGroup>();
  for (const row of rows) {
    const group = groups.get(row.plan_id) ?? {
      planId: row.plan_id,
      title: row.plan_title,
      serviceDate: row.service_date,
      serviceType: row.service_type,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.plan_id, group);
  }
  return [...groups.values()];
};

/**
 * MOB-022: the F16 multi-plan schedule report for schedulers, shared on
 * purpose. It reads `scheduleReport` (rows limited by the server to the teams
 * the caller schedules), shares the website's CSV (`reportCsv`) through the
 * OS share sheet only when asked, and queues/polls/opens tracked exports
 * (`requestReportExport`, `reportExports`, `reportExportDownload`). Printing
 * and the other report kinds stay on the website.
 */
export default function ScheduleReportScreen() {
  const params = useLocalSearchParams<ScheduleReportParams>();
  const { queryScope, canAnywhere, user, organizationId } = useAuth();
  const { t } = useTranslation(['reports', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const f = useFormatters();
  const queryClient = useQueryClient();
  const visible = useScreenVisible();
  const timezone = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? 'UTC';

  const [draft, setDraft] = useState<ReportFiltersRequest>(() => {
    const base = defaultReportFilters(Date.now(), timezone);
    return params.date ? planReportFilters({ service_date: params.date, service_type_id: params.serviceTypeId ?? null }, base) : base;
  });
  // Opened from a plan, the report runs at once; otherwise after "Run report".
  const [applied, setApplied] = useState<ReportFiltersRequest | null>(() => (params.date ? draft : null));
  const [picker, setPicker] = useState<DateField | null>(null);
  const [shared, setShared] = useState<ShareOutcome | null>(null);
  // One export per run: retries and double taps reuse the key, so the server returns the same export.
  const exportKey = useMemo(() => (applied ? newIdempotencyKey() : null), [applied]);

  const allowed = canAnywhere('scheduling.manage');
  const serviceTypes = useQuery({
    queryKey: queryKeys.serviceTypes(queryScope),
    queryFn: () => api.listServiceTypes(),
    enabled: Boolean(queryScope) && allowed,
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope) && allowed,
  });
  const report = useQuery({
    queryKey: queryKeys.scheduleReport(queryScope, applied),
    queryFn: () => api.scheduleReport(applied!),
    enabled: Boolean(queryScope && applied) && allowed,
  });
  const exports = useQuery({
    queryKey: queryKeys.reportExports(queryScope),
    queryFn: () => api.reportExports(),
    enabled: Boolean(queryScope) && allowed,
    refetchInterval: (query) => (visible && reportExportsInProgress(query.state.data) ? EXPORT_POLL_MS : false),
  });

  const shareCsv = useMutation({
    mutationFn: async (filters: ReportFiltersRequest): Promise<ShareOutcome> => {
      const csv = await api.reportCsv('schedule', filters);
      const result = await Share.share({ title: reportCsvFilename('schedule', filters), message: csv });
      return shareOutcome(result);
    },
    gcTime: 0,
    onMutate: () => setShared(null),
    onSuccess: setShared,
  });
  const queueExport = useMutation({
    mutationFn: (input: { filters: ReportFiltersRequest; key: string }) =>
      api.requestReportExport({ kind: 'schedule', filters: input.filters, idempotency_key: input.key }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reportExports(queryScope) }),
  });

  if (!allowed) {
    return (
      <Screen>
        <EmptyState title={t('page.leadersOnlyTitle')} description={t('page.leadersOnlyDescription')} />
      </Screen>
    );
  }

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || !value || !picker) return;
    setDraft({ ...draft, [picker]: civilDate(value) });
  };
  const rangeOk = reportRangeInOrder(draft);

  return (
    <Screen>
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.content]}>
        <Text style={styles.body}>{t('page.subtitle', { timezone })}</Text>

        <Card>
          <View style={styles.row}>
            <Button
              title={`${t('filters.from')}: ${f.calendarDate(draft.from, 'medium')}`}
              variant="secondary"
              onPress={() => setPicker(picker === 'from' ? null : 'from')}
            />
            <Button
              title={`${t('filters.to')}: ${f.calendarDate(draft.to, 'medium')}`}
              variant="secondary"
              onPress={() => setPicker(picker === 'to' ? null : 'to')}
            />
          </View>
          {picker ? (
            <DateTimePicker
              value={dateForPicker(draft[picker])}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={onPickerChange}
            />
          ) : null}
          {!rangeOk ? <Meta>{t('mobileReport.rangeOrder')}</Meta> : null}

          <Label>{t('filters.serviceType')}</Label>
          <View style={styles.row}>
            <Chip
              label={t('filters.allVisible')}
              active={!draft.service_type_ids?.length}
              onPress={() => setDraft({ ...draft, service_type_ids: [] })}
            />
            {(serviceTypes.data ?? []).map((serviceType) => (
              <Chip
                key={serviceType.id}
                label={serviceType.name}
                active={draft.service_type_ids?.[0] === serviceType.id}
                onPress={() => setDraft({ ...draft, service_type_ids: [serviceType.id] })}
              />
            ))}
          </View>

          <Label>{t('filters.team')}</Label>
          <View style={styles.row}>
            <Chip
              label={t('filters.allVisible')}
              active={!draft.team_ids?.length}
              onPress={() => setDraft({ ...draft, team_ids: [] })}
            />
            {(teams.data ?? []).map((team) => (
              <Chip
                key={team.id}
                label={team.name}
                active={draft.team_ids?.[0] === team.id}
                onPress={() => setDraft({ ...draft, team_ids: [team.id] })}
              />
            ))}
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>{t('filters.includeRehearsals')}</Text>
            <Switch
              value={draft.include_rehearsals ?? false}
              onValueChange={(value) => setDraft({ ...draft, include_rehearsals: value })}
              accessibilityLabel={t('filters.includeRehearsals')}
            />
          </View>
          <Meta>{t('mobileReport.otherFilters')}</Meta>
          <ErrorNotice error={serviceTypes.error ?? teams.error} />
          <Button title={t('filters.run')} disabled={!rangeOk} onPress={() => setApplied({ ...draft })} />
        </Card>

        {!applied ? (
          <EmptyState title={t('results.choose')} />
        ) : report.isLoading ? (
          <Loading label={t('results.building')} />
        ) : report.error ? (
          <Card>
            <ErrorNotice error={report.error} />
            <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void report.refetch()} />
          </Card>
        ) : report.data ? (
          <ReportResult
            report={report.data}
            sharing={shareCsv.isPending}
            shared={shared}
            shareError={shareCsv.error}
            queueing={queueExport.isPending}
            queued={queueExport.isSuccess}
            queueError={queueExport.error}
            onShare={() => shareCsv.mutate(applied)}
            onQueue={() => exportKey && queueExport.mutate({ filters: applied, key: exportKey })}
          />
        ) : null}

        <Card>
          <Label>{t('exports.title')}</Label>
          <Meta>{t('exports.help')}</Meta>
          <Meta>{t('mobileReport.exportsOpen')}</Meta>
          <ErrorNotice error={exports.error} />
          {exports.isLoading ? <Loading /> : null}
          {exports.data && exports.data.length === 0 ? <Text style={styles.body}>{t('exports.empty')}</Text> : null}
          {(exports.data ?? []).map((row, index) => (
            <View key={row.id}>
              {index > 0 ? <Divider /> : null}
              <ExportRow row={row} />
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

interface ReportResultProps {
  report: ScheduleReport;
  sharing: boolean;
  shared: ShareOutcome | null;
  shareError: unknown;
  queueing: boolean;
  queued: boolean;
  queueError: unknown;
  onShare: () => void;
  onQueue: () => void;
}

const ReportResult = ({
  report,
  sharing,
  shared,
  shareError,
  queueing,
  queued,
  queueError,
  onShare,
  onQueue,
}: ReportResultProps) => {
  const { t } = useTranslation(['reports', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const f = useFormatters();
  const groups = useMemo(() => groupByPlan(report.rows), [report.rows]);
  const timeZone = report.filters.timezone;

  return (
    <>
      <Card>
        <Label>{t('kinds.schedule')}</Label>
        <Meta>
          {[
            t('results.generated', { time: f.dateTime(report.generated_at, { timeZone }), timezone: timeZone }),
            // The server sends one fixed note per kind; schedule reports are limited to teams the caller schedules.
            report.scope_note ? t('scopeNote.scheduling') : null,
            report.truncated ? t('results.truncated') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Meta>
        <View style={styles.summary}>
          {([
            ['plans', report.summary.plans],
            ['assignments', report.summary.assignments],
            ['people', report.summary.people],
          ] as const).map(([key, value]) => (
            <View key={key} style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{f.number(value)}</Text>
              <Meta>{t(`summary.${key}`)}</Meta>
            </View>
          ))}
        </View>
        <Button title={t('mobileReport.shareCsv')} icon="upload" loading={sharing} onPress={onShare} />
        {shared === 'handedOff' ? <Meta>{t('mobileReport.shareHandedOff')}</Meta> : null}
        {shared === 'cancelled' ? <Meta>{t('mobileReport.shareCancelled')}</Meta> : null}
        <Button title={t('results.queueExport')} variant="secondary" loading={queueing} onPress={onQueue} />
        {queued ? <Meta>{t('mobileReport.exportQueued')}</Meta> : null}
        <ErrorNotice error={shareError ?? queueError} />
        <Meta>{t('mobileReport.printOnWeb')}</Meta>
      </Card>

      {groups.length === 0 ? (
        <EmptyState title={t('results.noMatches')} />
      ) : (
        groups.map((group) => (
          <Card key={group.planId}>
            <Text style={styles.planTitle}>{group.title}</Text>
            <Meta>
              {[f.calendarDate(group.serviceDate, 'medium'), group.serviceType].filter(Boolean).join(' · ')}
            </Meta>
            {group.rows.map((row, index) => (
              <View key={`${row.person_id}:${row.team_name}:${row.position_name}:${index}`}>
                <Divider />
                <View style={styles.reportRow}>
                  <View style={styles.flex}>
                    <Text style={styles.label}>{row.person_name}</Text>
                    <Meta>
                      {[row.team_name, row.position_name, row.times.join(t('common:format.listSeparator'))]
                        .filter(Boolean)
                        .join(' · ')}
                    </Meta>
                  </View>
                  <Tag label={t(`common:assignmentStatus.${row.response}`)} accent={statusAccent(theme, row.response)} />
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
    </>
  );
};

interface ExportRowProps {
  row: ReportExportSummary;
}

/** One export: status, failure reason, expiry, and the action that status allows. */
const ExportRow = ({ row }: ExportRowProps) => {
  const { t } = useTranslation(['reports', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const f = useFormatters();
  const { queryScope } = useAuth();
  const queryClient = useQueryClient();
  const status = reportExportStatusAt(row, Date.now());
  const errorKey = reportExportErrorKey(row.error_code);

  // The signed link lasts minutes and is handed straight to the OS, never kept.
  const open = useMutation({
    mutationFn: async () => {
      const link = await api.reportExportDownload(row.id);
      await Linking.openURL(link.url);
    },
    gcTime: 0,
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.reportExports(queryScope) }),
  });
  const rebuild = useMutation({
    mutationFn: () => api.retryReportExport(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reportExports(queryScope) }),
  });

  return (
    <View style={styles.exportRow}>
      <View style={styles.reportRow}>
        <Text style={[styles.label, styles.flex]}>
          {t('exports.range', {
            kind: t(`kinds.${row.kind}`),
            from: f.calendarDate(String(row.filters.from), 'medium'),
            to: f.calendarDate(String(row.filters.to), 'medium'),
          })}
        </Text>
        <Tag label={t(`exports.status.${status}`)} accent={theme.accent[REPORT_EXPORT_STATUS_ACCENTS[status]]} />
      </View>
      {errorKey ? <Meta>{t(`exports.errors.${errorKey}`)}</Meta> : null}
      {status === 'ready' && row.expires_at ? <Meta>{t('exports.until', { time: f.dateTime(row.expires_at) })}</Meta> : null}
      {status === 'ready' ? (
        <Button title={t('common:actions.open')} variant="secondary" loading={open.isPending} onPress={() => open.mutate()} />
      ) : null}
      {canRebuildReportExport(status) ? (
        <Button title={t('exports.buildAgain')} variant="quiet" loading={rebuild.isPending} onPress={() => rebuild.mutate()} />
      ) : null}
      <ErrorNotice error={open.error ?? rebuild.error} />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { gap: theme.space.lg },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    label: { ...theme.type.label, color: theme.color.ink },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    summary: { flexDirection: 'row', gap: theme.space.md },
    summaryTile: { flex: 1 },
    summaryValue: { ...theme.type.display, fontSize: 28, lineHeight: 32, color: theme.color.ink },
    planTitle: { ...theme.type.heading, color: theme.color.ink },
    reportRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.sm },
    exportRow: { gap: theme.space.xs, paddingVertical: theme.space.sm },
  });

import { useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type CopyAvailabilityResult, type ScheduleSettingsInput } from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import { newIdempotencyKey } from '../src/lib/idempotency';
import {
  combinedScheduleWindow,
  combinedSections,
  copyAvailabilityBody,
  copySelectionSignature,
  copyTargets,
  copyableBlockouts,
  scheduleSettingsInput,
  timeZoneNote,
  type CombinedSection,
  type CombinedSectionRow,
} from '../src/lib/combined-schedule';
import { useAuth } from '../src/providers/AuthProvider';
import { useNavigationIntents } from '../src/providers/NavigationIntentProvider';
import { useFormatters } from '../src/i18n/useFormatters';
import { Button, Card, Chip, EmptyState, ErrorNotice, Label, ListRow, Loading, Screen, ScreenHeader, Tag, screenPadding } from '../src/components/ui';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * MOB-032: the website's *Across my churches* (`AcrossOrganizations`). Off
 * until the person turns it on; then the server reads each organization
 * separately with that organization's permissions, so one failing or revoked
 * organization is shown as such while the others still load. Times are shown
 * in each organization's own zone when it differs from this device's. Copying
 * blockouts is a separate, reviewed operation.
 */
export default function AcrossOrganizationsScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const { queryScope, user, organizationId, generation, isCurrentGeneration, refreshUser } = useAuth();
  const { openPlanInOrganization } = useNavigationIntents();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const formatters = useFormatters();
  // Fixed for the screen's life so the cache key is stable; pull to refresh renews it.
  const [window, setWindow] = useState(() => combinedScheduleWindow(new Date()));
  const deviceZone = deviceTimeZone();

  const settings = useQuery({
    queryKey: queryKeys.scheduleSettings(queryScope),
    queryFn: () => api.scheduleSettings(),
    enabled: Boolean(queryScope),
  });
  const current = scheduleSettingsInput(settings.data);
  const combined = useQuery({
    queryKey: queryKeys.combinedSchedule(queryScope, window),
    queryFn: () => api.combinedSchedule(window),
    enabled: Boolean(queryScope && current.combined_schedule),
  });
  // Turned off on another device since this screen read the setting.
  const turnedOffElsewhere = combined.error instanceof ApiError && combined.error.status === 403;

  const update = useMutation({
    mutationFn: (body: ScheduleSettingsInput) => api.updateScheduleSettings(body),
    onSuccess: async (saved) => {
      if (!isCurrentGeneration(generation)) return;
      queryClient.setQueryData(queryKeys.scheduleSettings(queryScope), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.combinedScheduleAll(queryScope) });
    },
  });

  const sections = useMemo(
    () => (combined.data && user ? combinedSections(combined.data, user, organizationId) : []),
    [combined.data, user, organizationId],
  );
  const memberships = user?.memberships ?? [];

  const refresh = async (): Promise<void> => {
    await refreshUser();
    if (!isCurrentGeneration(generation)) return;
    setWindow(combinedScheduleWindow(new Date()));
    await settings.refetch();
  };

  const when = (row: CombinedSectionRow, section: CombinedSection): string => {
    const zone = timeZoneNote(section.timeZone, deviceZone);
    if (!zone) return formatters.dateTime(row.item.starts_at);
    return t('mobileAcross.whenInZone', {
      when: formatters.dateTime(row.item.starts_at, { timeZone: zone }),
      zone,
      local: formatters.time(row.item.starts_at),
    });
  };
  const titleOf = (row: CombinedSectionRow): string =>
    row.title.kind === 'assignment'
      ? row.title.title
      : row.title.kind === 'unavailableWithTitle'
        ? t('across.unavailableWithTitle', { title: row.title.title })
        : t('across.unavailable');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('across.title') }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.stack]}
        refreshControl={<RefreshControl refreshing={combined.isRefetching || settings.isRefetching} onRefresh={() => void refresh()} />}
      >
        <ScreenHeader title={t('across.title')} description={t('across.description', { count: memberships.length })} />
        {memberships.length < 2 ? <Text style={styles.muted}>{t('mobileAcross.singleOrganization')}</Text> : null}

        <Card>
          {settings.isLoading ? (
            <Loading />
          ) : (
            <>
              <View style={styles.switchRow}>
                <Text style={[styles.body, styles.flex]}>{t('across.combinedSchedule')}</Text>
                <Switch
                  accessibilityLabel={t('across.combinedSchedule')}
                  value={current.combined_schedule}
                  disabled={update.isPending || !settings.data}
                  onValueChange={(value) => update.mutate({ ...current, combined_schedule: value })}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={[styles.body, styles.flex]}>{t('across.shareBusy')}</Text>
                <Switch
                  accessibilityLabel={t('across.shareBusy')}
                  value={current.share_busy_across_orgs}
                  disabled={update.isPending || !settings.data}
                  onValueChange={(value) => update.mutate({ ...current, share_busy_across_orgs: value })}
                />
              </View>
              <Text style={styles.muted}>{t('mobileAcross.selfOnly')}</Text>
            </>
          )}
          <ErrorNotice error={settings.error ?? update.error} />
        </Card>

        {current.combined_schedule ? (
          <View style={styles.stack}>
            <Label>{t('across.next30Days')}</Label>
            {combined.isLoading ? <Loading /> : null}
            {turnedOffElsewhere ? (
              <Card>
                <Text style={styles.body}>{t('mobileAcross.turnedOff')}</Text>
                <Button title={t('common:actions.refresh')} variant="secondary" onPress={() => void settings.refetch()} />
              </Card>
            ) : (
              <ErrorNotice error={combined.error} />
            )}
            {sections.map((section) => (
              <Card key={section.organizationId}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.orgName, styles.flex]}>{section.organizationName}</Text>
                  {section.isActive ? <Tag label={t('mobileAcross.current')} accent={theme.accent.blue} /> : null}
                </View>
                {timeZoneNote(section.timeZone, deviceZone) ? (
                  <Text style={styles.muted}>{t('mobileAcross.zoneNote', { zone: section.timeZone })}</Text>
                ) : null}
                {section.state === 'error' ? (
                  <Text accessibilityRole="alert" style={styles.error}>{t('across.loadFailed', { error: section.error ?? '' })}</Text>
                ) : section.state === 'revoked' ? (
                  <Text style={styles.muted}>{t('mobileAcross.revoked')}</Text>
                ) : (
                  <>
                    {section.state === 'stale' ? <Text style={styles.warning}>{t('mobileAcross.stale')}</Text> : null}
                    {section.rows.length ? (
                      section.rows.map((row, index) => {
                        const content = (
                          <View style={styles.flex}>
                            <Text style={styles.body}>{titleOf(row)}</Text>
                            <Text style={styles.muted}>{when(row, section)}</Text>
                            {row.awaitingAnswer ? (
                              <View style={styles.tags}>
                                <Tag label={t('mobileAcross.awaiting')} accent={theme.accent.yellow} />
                              </View>
                            ) : null}
                          </View>
                        );
                        const planId = row.planId;
                        return planId ? (
                          <ListRow
                            key={row.key}
                            divided={index > 0}
                            showChevron
                            onPress={() => openPlanInOrganization(section.organizationId, planId)}
                          >
                            {content}
                          </ListRow>
                        ) : (
                          <ListRow key={row.key} divided={index > 0}>
                            {content}
                          </ListRow>
                        );
                      })
                    ) : (
                      <Text style={styles.muted}>{t('across.nothingScheduled')}</Text>
                    )}
                  </>
                )}
              </Card>
            ))}
            {sections.some((section) => !section.isActive && section.rows.some((row) => row.planId)) ? (
              <Text style={styles.muted}>{t('mobileAcross.openSwitches')}</Text>
            ) : null}
          </View>
        ) : settings.data ? (
          <EmptyState title={t('mobileAcross.offTitle')} description={t('mobileAcross.offDescription')} />
        ) : null}

        {memberships.length > 1 ? <CopyBlockouts /> : null}
      </ScrollView>
    </Screen>
  );
}

/** The website's *Copy blockout dates to another church*, with a review step before anything is written. */
const CopyBlockouts = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { queryScope, user, organizationId, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const formatters = useFormatters();
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [includeReason, setIncludeReason] = useState(false);
  const [result, setResult] = useState<CopyAvailabilityResult | null>(null);
  // One key per reviewed selection: a retry after a lost answer reuses it, a changed selection gets a new one.
  const keyRef = useRef<{ signature: string; key: string } | null>(null);

  const blockouts = useQuery({
    queryKey: queryKeys.blockouts(queryScope),
    queryFn: () => api.listBlockouts({ scope: 'mine' }),
    enabled: Boolean(queryScope),
  });
  const rows = copyableBlockouts(blockouts.data ?? []);
  const others = user ? copyTargets(user, organizationId) : [];
  const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const nameOf = (id: string): string =>
    user?.memberships.find((membership) => membership.organization.id === id)?.organization.name ?? t('organization.fallbackName');

  const copy = useMutation({
    mutationFn: (key: string) => api.copyAvailability(copyAvailabilityBody(selected, targets, includeReason, key)),
    onSuccess: async (saved) => {
      if (!isCurrentGeneration(generation)) return;
      setResult(saved);
      keyRef.current = null;
      await queryClient.invalidateQueries({ queryKey: queryKeys.combinedScheduleAll(queryScope) });
    },
  });

  const review = (): void => {
    const signature = copySelectionSignature(selected, targets, includeReason);
    if (keyRef.current?.signature !== signature) keyRef.current = { signature, key: newIdempotencyKey() };
    const key = keyRef.current.key;
    Alert.alert(
      t('mobileAcross.reviewTitle'),
      t('mobileAcross.reviewMessage', {
        count: selected.length,
        targets: formatters.list(targets.map(nameOf)),
        reasons: includeReason ? t('mobileAcross.reasonsIncluded') : t('mobileAcross.reasonsPrivate'),
      }),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('common:actions.copy'), onPress: () => copy.mutate(key) },
      ],
    );
  };

  return (
    <Card>
      <Label>{t('across.copyTitle')}</Label>
      {blockouts.isLoading ? <Loading /> : null}
      <ErrorNotice error={blockouts.error} />
      {!blockouts.isLoading && rows.length === 0 ? (
        <Text style={styles.muted}>{t('mobileAcross.copyEmpty')}</Text>
      ) : (
        <>
          <View style={styles.chips}>
            {rows.map((blockout) => (
              <Chip
                key={blockout.id}
                toggle
                active={selected.includes(blockout.id)}
                onPress={() => setSelected(toggle(selected, blockout.id))}
                label={`${t(blockout.all_day ? 'across.blockoutAllDay' : 'across.blockout', {
                  date: blockout.local_start_date ? formatters.calendarDate(blockout.local_start_date) : formatters.dateTime(blockout.starts_at),
                })}${blockout.reason ? ` — ${blockout.reason}` : ''}`}
              />
            ))}
          </View>
          <Text style={styles.muted}>{t('mobileAcross.copyTo')}</Text>
          <View style={styles.chips}>
            {others.map((membership) => (
              <Chip
                key={membership.organization.id}
                toggle
                active={targets.includes(membership.organization.id)}
                onPress={() => setTargets(toggle(targets, membership.organization.id))}
                label={membership.organization.name}
              />
            ))}
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.body, styles.flex]}>{t('across.includeReason')}</Text>
            <Switch accessibilityLabel={t('across.includeReason')} value={includeReason} onValueChange={setIncludeReason} />
          </View>
          <ErrorNotice error={copy.error} />
          <Button
            title={copy.isError ? t('common:actions.retry') : t('mobileAcross.reviewCopy')}
            variant="secondary"
            loading={copy.isPending}
            disabled={!selected.length || !targets.length}
            onPress={review}
          />
          {result ? (
            <View style={styles.results}>
              {result.results.map((entry) => (
                <Text key={entry.organization_id} style={styles.muted}>
                  {entry.copied
                    ? t('across.resultWithCount', { name: nameOf(entry.organization_id), outcome: t(`across.outcome.${entry.outcome}`), copied: entry.copied })
                    : t('across.result', { name: nameOf(entry.organization_id), outcome: t(`across.outcome.${entry.outcome}`) })}
                  {entry.error ? ` — ${entry.error}` : ''}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: theme.space.lg },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.xs },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    orgName: { ...theme.type.label, color: theme.color.inkMuted, textTransform: 'uppercase' },
    tags: { flexDirection: 'row', marginTop: theme.space.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
    results: { gap: theme.space.xs },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    error: { ...theme.type.bodySmall, color: theme.color.danger },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });

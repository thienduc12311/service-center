import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, rehearsalPlaylist } from '@service-center/shared';
import { api } from './api';
import { queryKeys } from './query-keys';
import { groupSchedule, scheduleWindowQuery } from './schedule-groups';
import {
  buildScheduleWidgetTimeline,
  groupEndsAt,
  signedOutWidgetProps,
  type ScheduleWidgetText,
} from './schedule-widget';
import { clearScheduleWidget, widgetsSupported, writeScheduleWidgetTimeline } from './widget-bridge';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters } from '../i18n/useFormatters';

/**
 * MOB-033: keeps the iOS widget's snapshot in step with the signed-in
 * account and active organization. It reads the same `mySchedule` cache the
 * My Schedule tab uses (and the next plan's rehearsal manifest), rewrites the
 * timeline whenever they change or the app returns to the foreground, and
 * replaces it with a signed-out state on sign-out or an identity change, so
 * one account's schedule is never left on the home screen for another.
 */
export const useScheduleWidgetSync = (): void => {
  const { t } = useTranslation('settings');
  const formatters = useFormatters();
  const { session, ready, user, organizationId, queryScope } = useAuth();
  const supported = useMemo(() => widgetsSupported(), []);
  const active = Boolean(supported && session && ready && queryScope && organizationId);

  const text = useMemo<ScheduleWidgetText>(
    () => ({
      heading: t('mobileWidget.heading'),
      empty: t('mobileWidget.empty'),
      signedOut: t('mobileWidget.signedOut'),
      expired: t('mobileWidget.expired'),
      awaiting: t('mobileWidget.awaiting'),
      rehearse: t('mobileWidget.rehearse'),
      updated: t('mobileWidget.updated'),
    }),
    [t],
  );

  // Identity change (sign-out, account or organization switch): clear before anything new loads.
  const identity = queryScope ? `${queryScope.userId}:${queryScope.organizationId}:${queryScope.generation}` : 'none';
  const lastIdentity = useRef<string | null>(null);
  useEffect(() => {
    if (!supported || lastIdentity.current === identity) return;
    lastIdentity.current = identity;
    clearScheduleWidget(signedOutWidgetProps(text));
  }, [identity, supported, text]);

  const schedule = useQuery({
    queryKey: queryKeys.scheduleWindow(queryScope, 'upcoming'),
    queryFn: () => api.mySchedule(scheduleWindowQuery('upcoming', new Date())),
    enabled: active,
  });
  const groups = useMemo(
    () => groupSchedule(schedule.data ?? [], organizationId ?? '', 'upcoming'),
    [schedule.data, organizationId],
  );
  const now = Date.now();
  const nextPlanId =
    groups
      .filter((group) => groupEndsAt(group) > now)
      .filter((group) => group.responsibilities.some((r) => r.status === 'confirmed' || r.status === 'unconfirmed'))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]?.plan.id ?? null;
  const manifest = useQuery({
    queryKey: queryKeys.rehearsal(queryScope, nextPlanId),
    queryFn: () => api.rehearsalManifest(nextPlanId ?? ''),
    enabled: active && Boolean(nextPlanId),
  });

  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void schedule.refetch();
    });
    return () => subscription.remove();
  }, [active, schedule]);

  const organizationName = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.name ?? '';
  useEffect(() => {
    if (!active || !organizationId || !schedule.data) return;
    // A manifest still loading is written once it settles; a failed one just offers no rehearse link.
    if (nextPlanId && manifest.isLoading) return;
    const tracks = nextPlanId && manifest.data ? rehearsalPlaylist(manifest.data).length : 0;
    writeScheduleWidgetTimeline(
      buildScheduleWidgetTimeline({
        now: new Date(),
        organization: { id: organizationId, name: organizationName },
        groups,
        rehearsalTracks: nextPlanId ? { [nextPlanId]: tracks } : {},
        text,
        formatWhen: (startsAt) => formatters.dateTime(startsAt),
      }),
    );
  }, [active, formatters, groups, manifest.data, manifest.isLoading, nextPlanId, organizationId, organizationName, schedule.data, text]);

  // A read refused for this account (membership removed, signed out elsewhere): show nothing personal.
  const refused = schedule.error instanceof ApiError && [401, 403, 404].includes(schedule.error.status);
  useEffect(() => {
    if (supported && refused) clearScheduleWidget(signedOutWidgetProps(text));
  }, [refused, supported, text]);
};

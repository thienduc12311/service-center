import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  OrphanResolutionAction,
  PlanTimeImpact,
  PlanTimeImpactAssignment,
  PlanTimeImpactTime,
} from '@service-center/shared';
import { useFormatters } from '../i18n';
import { type Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { ConflictList } from './ConflictList';
import { Chip, Label } from './ui';

export interface TimeImpactReviewProps {
  impact: PlanTimeImpact;
  resolutions: Readonly<Record<string, OrphanResolutionAction>>;
  onResolve: (assignmentId: string, action: OrphanResolutionAction) => void;
  notify: boolean;
  onNotifyChange: (notify: boolean) => void;
  /** Organization zone the times are shown in. */
  timeZone: string;
}

/**
 * The website's TimeImpactReview (F04): changed times, every request whose
 * attendance moves, requests left without a time (which must be resolved),
 * hidden requests, stale links, who is re-sent — plus the re-send choice,
 * which the commit carries as `notify_time_changes`.
 */
export const TimeImpactReview = ({ impact, resolutions, onResolve, notify, onNotifyChange, timeZone }: TimeImpactReviewProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const styles = useThemedStyles(makeStyles);
  const someone = t('common:fallback.someone');
  const clock = (instant: string) => format.time(instant, { timeZone });
  const when = (instant: string) => format.dateTime(instant, { timeZone });
  const nameOfTime = (time: PlanTimeImpactTime) => time.name || t(`timeKind.${time.kind}`);

  const timeNames = (ids: readonly string[]): string =>
    ids
      .map((timeId) => impact.times.find((time) => time.id === timeId))
      .filter((time): time is PlanTimeImpactTime => Boolean(time))
      .map((time) => t('timeImpact.timeName', { name: nameOfTime(time), time: clock(time.starts_at) }))
      .join(', ');
  const describe = (assignment: PlanTimeImpactAssignment): string =>
    [
      ...(assignment.gains.length ? [t('timeImpact.adds', { times: timeNames(assignment.gains) })] : []),
      ...(assignment.loses.length ? [t('timeImpact.drops', { times: timeNames(assignment.loses) })] : []),
      ...(assignment.changed.length ? [t('timeImpact.moves', { times: timeNames(assignment.changed) })] : []),
    ].join('; ');

  const changedTimes = impact.times.filter((time) => time.change !== 'unchanged');
  const names = new Map(impact.assignments.map((assignment) => [assignment.person_id, assignment.person_name ?? someone]));

  return (
    <View style={styles.wrap}>
      {impact.becomes_untimed ? <Text accessibilityRole="alert" style={styles.warning}>{t('timeImpact.untimed')}</Text> : null}

      {changedTimes.length ? (
        <View style={styles.group}>
          <Label>{t('timeImpact.times')}</Label>
          {changedTimes.map((time) => (
            <Text key={time.id} style={styles.line}>
              <Text style={styles.strong}>{t(`timeImpact.change.${time.change}`)}</Text>
              {` — ${nameOfTime(time)} · ${when(time.starts_at)}–${clock(time.ends_at)}`}
              {time.change === 'changed' && time.previous_starts_at && time.previous_ends_at
                ? ` ${t('timeImpact.was', { start: clock(time.previous_starts_at), end: clock(time.previous_ends_at) })}`
                : ''}
            </Text>
          ))}
        </View>
      ) : null}

      {impact.assignments.length ? (
        <View style={styles.group}>
          <Label>{t('timeImpact.requestsThatChange')}</Label>
          {impact.assignments.map((assignment) => (
            <View key={assignment.assignment_id} style={styles.request}>
              <Text style={styles.body}>
                <Text style={styles.strong}>{assignment.person_name ?? someone}</Text>
                <Text style={styles.line}>
                  {' · '}
                  {[
                    assignment.team_name ?? t('common:fallback.team'),
                    ...(assignment.position_name ? [assignment.position_name] : []),
                    ...(assignment.visibility === 'prepared' ? [t('timeImpact.prepared')] : []),
                  ].join(' · ')}
                </Text>
              </Text>
              {assignment.orphaned ? (
                <>
                  <Text style={styles.caution}>{t('timeImpact.orphaned')}</Text>
                  <View style={styles.chips}>
                    <Chip
                      label={t('timeImpact.keepAll')}
                      active={resolutions[assignment.assignment_id] === 'all'}
                      onPress={() => onResolve(assignment.assignment_id, 'all')}
                    />
                    <Chip
                      label={t('timeImpact.removeRequest')}
                      active={resolutions[assignment.assignment_id] === 'remove'}
                      onPress={() => onResolve(assignment.assignment_id, 'remove')}
                    />
                  </View>
                </>
              ) : (
                <Text style={styles.line}>{describe(assignment)}</Text>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {impact.hidden_affected > 0 ? (
        <Text style={styles.line}>{t('timeImpact.hiddenAffected', { count: impact.hidden_affected })}</Text>
      ) : null}
      <Text style={styles.line}>
        {[
          impact.notify_people > 0 && notify
            ? t('timeImpact.notifyPeople', { count: impact.notify_people })
            : impact.notify_people > 0
              ? t('editTimes.notifyOff')
              : t('timeImpact.notifyNobody'),
          ...(impact.live_requests > 0 ? [t('timeImpact.liveRequests', { count: impact.live_requests })] : []),
          t('timeImpact.answersKept'),
        ].join(' ')}
      </Text>
      {impact.notify_people > 0 ? (
        <View style={styles.switchRow}>
          <Text style={[styles.body, styles.flex]}>{t('editTimes.notify')}</Text>
          <Switch value={notify} onValueChange={onNotifyChange} accessibilityLabel={t('editTimes.notify')} />
        </View>
      ) : null}
      <Text style={styles.line}>{t('editTimes.remindersRecomputed')}</Text>

      {impact.conflicts.length ? (
        <View style={styles.group}>
          <Text style={styles.strong}>{t('timeImpact.conflicts')}</Text>
          <ConflictList conflicts={impact.conflicts} nameOf={(personId) => names.get(personId) ?? someone} />
        </View>
      ) : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.md },
    group: { gap: theme.space.xs },
    request: {
      gap: theme.space.xs,
      paddingVertical: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 44 },
    flex: { flex: 1 },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    line: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    caution: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });

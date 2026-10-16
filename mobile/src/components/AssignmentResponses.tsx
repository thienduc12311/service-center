import { StyleSheet, Text, View } from 'react-native';
import {
  ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH,
  ASSIGNMENT_STATUS_LABELS,
  formatDate,
  formatTime,
} from '@service-center/shared';
import type { AssignmentResponses } from '../lib/useAssignmentResponses';
import { reasonTooLong, type ResponseDraftMode } from '../lib/assignment-response-drafts';
import type {
  ScheduleGroupStatus,
  ScheduleResponsibility,
  ScheduleTime,
} from '../lib/schedule-groups';
import { statusAccent, type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Button, Divider, Field, Tag } from './ui';
import { Icon } from './icons';

const TIME_KIND_LABELS: Record<ScheduleTime['kind'], string> = {
  service: 'Service',
  rehearsal: 'Rehearsal',
  other: 'Time',
};

export const responsibilityLabel = (item: ScheduleResponsibility): string =>
  [item.team?.name ?? 'Team', item.position?.name].filter(Boolean).join(' — ');

export interface GroupStatusTagProps {
  status: ScheduleGroupStatus;
}

/** "Mixed" when positions were answered differently, never a misleading single status. */
export const GroupStatusTag = ({ status }: GroupStatusTagProps) => {
  const theme = useTheme();
  if (status === 'mixed') return <Tag label="Mixed replies" accent={theme.accent.neutral} />;
  return <Tag label={ASSIGNMENT_STATUS_LABELS[status]} accent={statusAccent(theme, status)} />;
};

export interface ScheduleTimesProps {
  times: readonly ScheduleTime[];
  responsibilities: readonly ScheduleResponsibility[];
}

/** Each time once; names the positions only when not every position needs it. */
export const ScheduleTimes = ({ times, responsibilities }: ScheduleTimesProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!times.length) return null;
  return (
    <View style={styles.times}>
      {times.map((time) => {
        const partial = time.requiredBy.length < responsibilities.length;
        const forWhom = partial
          ? responsibilities
              .filter((item) => time.requiredBy.includes(item.assignmentId))
              .map(responsibilityLabel)
              .join(', ')
          : null;
        return (
          <View key={time.id} style={styles.timeRow}>
            <Icon
              name="calendar"
              size={14}
              color={time.kind === 'rehearsal' ? theme.accent.yellow.fg : theme.color.inkMuted}
            />
            <Text style={styles.timeText}>
              {time.name ?? TIME_KIND_LABELS[time.kind]} · {formatDate(time.startsAt)},{' '}
              {formatTime(time.startsAt)}
              {forWhom ? ` · ${forWhom}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

export interface ResponsibilityListProps {
  responsibilities: readonly ScheduleResponsibility[];
  responses: AssignmentResponses;
  /** False for past plans: they are shown, not answered. */
  canRespond: boolean;
}

/** Every position the person holds on a plan, each answered on its own. */
export const ResponsibilityList = ({ responsibilities, responses, canRespond }: ResponsibilityListProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.list}>
      {responsibilities.map((item, index) => (
        <View key={item.assignmentId} style={styles.item}>
          {index > 0 ? <Divider /> : null}
          <ResponsibilityRow item={item} responses={responses} canRespond={canRespond} />
        </View>
      ))}
    </View>
  );
};

interface ResponsibilityRowProps {
  item: ScheduleResponsibility;
  responses: AssignmentResponses;
  canRespond: boolean;
}

/** The review step that still makes sense for the position's current status. */
const effectiveMode = (item: ScheduleResponsibility, mode: ResponseDraftMode): ResponseDraftMode => {
  if (mode === 'declining' && item.status === 'unconfirmed') return mode;
  if (mode === 'withdrawing' && item.status === 'confirmed') return mode;
  return 'idle';
};

const ResponsibilityRow = ({ item, responses, canRespond }: ResponsibilityRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const draft = responses.draft(item.assignmentId);
  const mode = effectiveMode(item, draft.mode);
  const label = responsibilityLabel(item);
  const tooLong = reasonTooLong(draft.reason);

  const reasonField = (
    <Field
      label="Reason (optional)"
      value={draft.reason}
      onChangeText={(reason) => responses.setReason(item.assignmentId, reason)}
      placeholder="Let your scheduler know why"
      multiline
      maxLength={ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH + 50}
      editable={!draft.pending}
      accessibilityHint={`Up to ${ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH} characters`}
      style={styles.reasonInput}
    />
  );

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          {item.team ? <View style={[styles.dot, { backgroundColor: item.team.color }]} /> : null}
          <Text style={styles.title}>{label}</Text>
        </View>
        <Tag label={ASSIGNMENT_STATUS_LABELS[item.status]} accent={statusAccent(theme, item.status)} />
      </View>

      {item.notes ? <Text style={styles.note}>Note from your scheduler: {item.notes}</Text> : null}
      {item.status === 'declined' && item.responseNote ? (
        <Text style={styles.note}>Your reason: {item.responseNote}</Text>
      ) : null}

      {canRespond && item.status === 'unconfirmed' && mode === 'idle' ? (
        <View style={styles.actionRow}>
          <Button
            title="Decline"
            variant="secondary"
            style={styles.flex}
            disabled={draft.pending}
            onPress={() => responses.open(item.assignmentId, 'declining')}
          />
          <Button
            title="Accept"
            icon="check"
            style={styles.flex}
            loading={draft.pending}
            onPress={() => responses.respond(item.assignmentId, item.status, 'confirmed')}
          />
        </View>
      ) : null}

      {canRespond && mode === 'declining' ? (
        <View style={styles.review}>
          <Text style={styles.reviewText}>Decline {label}?</Text>
          {reasonField}
          {tooLong ? (
            <Text style={styles.warning}>Keep the reason under {ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH} characters.</Text>
          ) : null}
          <View style={styles.actionRow}>
            <Button
              title="Cancel"
              variant="secondary"
              style={styles.flex}
              disabled={draft.pending}
              onPress={() => responses.cancel(item.assignmentId)}
            />
            <Button
              title="Decline"
              variant="danger"
              style={styles.flex}
              loading={draft.pending}
              disabled={tooLong}
              onPress={() => responses.respond(item.assignmentId, item.status, 'declined')}
            />
          </View>
        </View>
      ) : null}

      {canRespond && item.status === 'confirmed' && mode === 'idle' ? (
        <Button
          title="Withdraw…"
          variant="quiet"
          disabled={draft.pending}
          onPress={() => responses.open(item.assignmentId, 'withdrawing')}
        />
      ) : null}

      {canRespond && mode === 'withdrawing' ? (
        <View style={styles.review}>
          <Text style={styles.reviewText}>Withdraw your confirmation for {label}?</Text>
          <Text style={styles.note}>
            Your scheduler will be told. Your other positions on this plan stay as they are. To serve in
            this position again, a scheduler has to ask you again.
          </Text>
          {reasonField}
          {tooLong ? (
            <Text style={styles.warning}>Keep the reason under {ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH} characters.</Text>
          ) : null}
          <View style={styles.actionRow}>
            <Button
              title="Keep"
              variant="secondary"
              style={styles.flex}
              disabled={draft.pending}
              onPress={() => responses.cancel(item.assignmentId)}
            />
            <Button
              title="Withdraw"
              variant="danger"
              style={styles.flex}
              loading={draft.pending}
              disabled={tooLong}
              onPress={() => responses.respond(item.assignmentId, item.status, 'declined')}
            />
          </View>
        </View>
      ) : null}

      {canRespond && item.status === 'declined' ? (
        <Text style={styles.muted}>Ask a scheduler if you can serve in this position after all.</Text>
      ) : null}

      {draft.error ? (
        <View style={styles.errorWrap} accessibilityLiveRegion="polite">
          <View style={styles.errorRow}>
            <Icon name="alert" size={16} color={theme.accent.red.fg} />
            <Text style={styles.errorText}>{draft.error.message}</Text>
          </View>
          {draft.error.kind === 'network' && draft.request ? (
            <Button
              title="Try again"
              variant="secondary"
              loading={draft.pending}
              onPress={() => responses.retry(item.assignmentId)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    list: { gap: theme.space.md },
    item: { gap: theme.space.md },
    row: { gap: theme.space.md },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
    },
    titleWrap: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flex: 1 },
    dot: { width: 8, height: 8, borderRadius: theme.radius.pill },
    title: { ...theme.type.heading, color: theme.color.ink, flexShrink: 1 },
    note: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    muted: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    warning: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    review: { gap: theme.space.md },
    reviewText: { ...theme.type.body, color: theme.color.ink },
    reasonInput: { minHeight: 72, textAlignVertical: 'top' },
    actionRow: { flexDirection: 'row', gap: theme.space.md },
    errorWrap: { gap: theme.space.sm },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
    errorText: { ...theme.type.bodySmall, color: theme.accent.red.fg, flex: 1 },
    times: { gap: theme.space.xs },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    timeText: { ...theme.type.bodySmall, color: theme.color.inkMuted, flex: 1 },
  });

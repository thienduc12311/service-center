import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  formatDuration,
  resolveItemLeader,
  resolvePlanItemChartContext,
  type PlanDetail,
  type PlanItemDetail,
  type PlanSchedule,
  type PlannedItemTime,
} from '@service-center/shared';
import { leaderLine, type LeaderLine, type LeaderWords } from '../lib/plan-order-edit';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { useFormatters } from '../i18n';
import { PressableScale } from './motion';
import { Button, Chip, Divider, IconButton, KeyCap, Label, Tag } from './ui';

/** A service time the order can be timed against. */
export interface OrderServiceTime {
  id: string;
  name: string | null;
  starts_at: string;
}

export interface PlanOrderProps {
  plan: PlanDetail;
  /** F11 planned times for the selected service time (shared `computePlanSchedule`). */
  schedule: PlanSchedule;
  /** The organization's IANA zone; times show as the congregation reads them. */
  timeZone: string;
  serviceTimes: readonly OrderServiceTime[];
  selectedTimeId: string | null;
  onSelectTime: (timeId: string) => void;
  /** Position names for unfilled leader positions. */
  positionNames: ReadonlyMap<string, string>;
  /** `plans.edit` at this plan's service type: shows the editing controls. */
  canEdit: boolean;
  /** An order change is saving or the plan is refreshing: moves wait. */
  busy: boolean;
  onEdit: (item: PlanItemDetail) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (item: PlanItemDetail) => void;
  onOpenSong: (item: PlanItemDetail) => void;
  /** MOB-016: how many notes on each item this person can read (F09, server-filtered). */
  noteCounts: ReadonlyMap<string, number>;
  /** MOB-016: open an item's notes and discussion (every reader, as on the website). */
  onDiscuss: (item: PlanItemDetail) => void;
}

/**
 * MOB-014: the website Order tab on native — the same totals, planned starts,
 * key/arrangement/sequence (shared resolver), segment badges and leader line,
 * with Edit / Move up / Move down / Remove for plan editors. Moves are
 * buttons, so they work with VoiceOver and TalkBack without dragging.
 */
export const PlanOrder = ({
  plan,
  schedule,
  timeZone,
  serviceTimes,
  selectedTimeId,
  onSelectTime,
  positionNames,
  canEdit,
  busy,
  onEdit,
  onMove,
  onRemove,
  onOpenSong,
  noteCounts,
  onDiscuss,
}: PlanOrderProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const clock = (instant: string): string => format.time(instant, { timeZone });
  const slots = new Map(schedule.items.map((slot) => [slot.item_id, slot]));
  const overrun = schedule.warnings.find((warning) => warning.code === 'runs_over');
  const misplaced = new Set(schedule.warnings.flatMap((warning) => (warning.code === 'segment_out_of_order' && warning.item_id ? [warning.item_id] : [])));
  const words: LeaderWords = {
    someoneOnRoster: t('leader.someoneOnRoster'),
    position: t('leader.position'),
    someone: t('common:fallback.someone'),
    unfilled: (position) => t('leader.unfilled', { position }),
    holders: (position, names) => t('leader.holders', { position, names }),
    notYetAsked: (name) => t('leader.notYetAsked', { name }),
    list: format.list,
  };

  // Headers divide the order but aren't items in it, so they take no number.
  const ordinals = new Map<string, number>();
  for (const item of plan.items) if (item.item_type !== 'header') ordinals.set(item.id, ordinals.size + 1);

  return (
    <View style={styles.wrap}>
      <Text style={styles.muted}>
        {[
          t('common:count.items', { count: plan.counts.items }),
          t('orderTab.inService', { duration: formatDuration(schedule.service_seconds) }),
          ...(schedule.pre_seconds > 0 ? [t('orderTab.before', { duration: formatDuration(schedule.pre_seconds) })] : []),
          ...(schedule.post_seconds > 0 ? [t('orderTab.after', { duration: formatDuration(schedule.post_seconds) })] : []),
        ].join(' · ')}
      </Text>
      {schedule.planned_finish_at && schedule.service_starts_at ? (
        <Text style={styles.muted}>
          {/* The website's sentence with its emphasis markers removed. */}
          {t('orderTab.plannedFinish', {
            start: clock(schedule.service_starts_at),
            finish: clock(schedule.planned_finish_at),
            timeZone,
          }).replace(/<\/?\d>/g, '')}
        </Text>
      ) : null}

      {serviceTimes.length > 1 ? (
        <View style={styles.group}>
          <Label>{t('orderTab.timeFor')}</Label>
          <View style={styles.chips}>
            {serviceTimes.map((time) => (
              <Chip
                key={time.id}
                label={t('orderTab.serviceTimeOption', { name: time.name ?? t('timeKind.service'), time: clock(time.starts_at) })}
                active={time.id === selectedTimeId}
                onPress={() => onSelectTime(time.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {overrun ? (
        <Text accessibilityRole="alert" style={styles.warning}>
          {t('orderTab.overrun', { duration: formatDuration(overrun.seconds ?? 0) })}
        </Text>
      ) : null}
      {serviceTimes.length === 0 && plan.items.length > 0 ? (
        <Text style={styles.hint}>{t('orderTab.addServiceTimeHint')}</Text>
      ) : null}

      {plan.items.length === 0 ? (
        <Text style={styles.muted}>{canEdit ? t('orderTab.emptyCanManage') : t('mobilePlan.emptyOrder')}</Text>
      ) : (
        <View accessibilityState={{ busy }}>
          {plan.items.map((item, index) => (
            <View key={item.id}>
              {index > 0 && item.item_type !== 'header' ? <Divider /> : null}
              <OrderRow
                item={item}
                ordinal={ordinals.get(item.id) ?? null}
                slot={slots.get(item.id) ?? null}
                clock={clock}
                leader={leaderLine(resolveItemLeader({ item, assignments: plan.assignments, positionNames }), words)}
                misplaced={misplaced.has(item.id)}
                canEdit={canEdit}
                busy={busy}
                isFirst={index === 0}
                isLast={index === plan.items.length - 1}
                onEdit={() => onEdit(item)}
                onMoveUp={() => onMove(index, -1)}
                onMoveDown={() => onMove(index, 1)}
                onRemove={() => onRemove(item)}
                onOpenSong={() => onOpenSong(item)}
                noteCount={noteCounts.get(item.id) ?? 0}
                onDiscuss={() => onDiscuss(item)}
                theme={theme}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

interface OrderRowProps {
  item: PlanItemDetail;
  ordinal: number | null;
  slot: PlannedItemTime | null;
  clock: (instant: string) => string;
  leader: LeaderLine | null;
  misplaced: boolean;
  canEdit: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onOpenSong: () => void;
  noteCount: number;
  onDiscuss: () => void;
  theme: Theme;
}

const OrderRow = ({
  item,
  ordinal,
  slot,
  clock,
  leader,
  misplaced,
  canEdit,
  busy,
  isFirst,
  isLast,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
  onOpenSong,
  noteCount,
  onDiscuss,
  theme,
}: OrderRowProps) => {
  const { t } = useTranslation(['plans', 'messages', 'common']);
  const styles = useThemedStyles(makeStyles);

  const discuss = item.item_type !== 'header' ? (
    <Button
      title={noteCount > 0 ? t('orderTab.noteCount', { count: noteCount }) : t('messages:itemDiscussion.discussion')}
      accessibilityLabel={t('orderTab.notesFor', { title: item.title })}
      icon="chat"
      variant="quiet"
      onPress={onDiscuss}
    />
  ) : null;
  // The editing buttons stay together: on a narrow row they move below the
  // discussion button as a group instead of splitting.
  const controls = canEdit || discuss ? (
    <View style={styles.controls}>
      {discuss}
      {canEdit ? (
        <View style={styles.editControls}>
          <EditControls item={item} busy={busy} isFirst={isFirst} isLast={isLast} onEdit={onEdit} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
        </View>
      ) : null}
    </View>
  ) : null;
  return <OrderRowBody item={item} ordinal={ordinal} slot={slot} clock={clock} leader={leader} misplaced={misplaced} controls={controls} onOpenSong={onOpenSong} theme={theme} />;
};

interface EditControlsProps {
  item: PlanItemDetail;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

/** Edit / Move up / Move down / Remove, for plan editors. */
const EditControls = ({ item, busy, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }: EditControlsProps) => {
  const { t } = useTranslation(['plans', 'common']);
  return (
    <>
      <IconButton name="pencil" accessibilityLabel={t('orderTab.editItem', { title: item.title })} onPress={onEdit} />
      <IconButton name="chevronUp" accessibilityLabel={t('orderTab.moveUp', { title: item.title })} disabled={isFirst || busy} onPress={onMoveUp} />
      <IconButton name="chevronDown" accessibilityLabel={t('orderTab.moveDown', { title: item.title })} disabled={isLast || busy} onPress={onMoveDown} />
      <IconButton name="trash" accessibilityLabel={t('orderTab.removeItem', { title: item.title })} disabled={busy} onPress={onRemove} />
    </>
  );
};

interface OrderRowBodyProps {
  item: PlanItemDetail;
  ordinal: number | null;
  slot: PlannedItemTime | null;
  clock: (instant: string) => string;
  leader: LeaderLine | null;
  misplaced: boolean;
  controls: ReactNode;
  onOpenSong: () => void;
  theme: Theme;
}

const OrderRowBody = ({ item, ordinal, slot, clock, leader, misplaced, controls, onOpenSong, theme }: OrderRowBodyProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);

  if (item.item_type === 'header') {
    return (
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.headerTitle}>{item.title.toUpperCase()}</Text>
        {controls}
      </View>
    );
  }

  const context = resolvePlanItemChartContext(item);
  const segment = item.service_segment ?? 'service';

  return (
    <View style={styles.item}>
      <PressableScale disabled={!item.song} onPress={onOpenSong} pressedOpacity={0.6} style={styles.itemTop}>
        <View style={styles.lead}>
          <Text style={styles.ordinal}>{String(ordinal ?? 0).padStart(2, '0')}</Text>
          <Text style={styles.start}>{slot ? clock(slot.starts_at) : '—'}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={[styles.title, item.song ? styles.titleLink : null]}>{item.title}</Text>
          {context.status === 'ready' && (context.arrangement || context.sequence.length > 0) ? (
            <Text style={styles.meta}>
              {[
                context.arrangement?.name,
                context.sequence.length > 0 ? context.sequence.join(' · ') : null,
              ].filter(Boolean).join(' · ')}
              {context.sequenceFromPlan ? ` ${t('orderTab.sequenceThisPlan')}` : ''}
              {context.arrangement?.bpm ? ` · ${t('orderTab.bpm', { bpm: context.arrangement.bpm })}` : ''}
            </Text>
          ) : null}
          {item.description ? <Text style={styles.meta}>{item.description}</Text> : null}
          {leader ? (
            <Text style={[styles.meta, leader.unfilled && styles.unfilled]}>{t('orderTab.ledBy', { leader: leader.text })}</Text>
          ) : null}
          {item.media ? (
            <Text style={styles.meta}>
              {t(item.media.archived ? 'orderTab.mediaLinkArchived' : 'orderTab.mediaLink', { title: item.media.title }).replace(/<\/?\d>/g, '')}
            </Text>
          ) : null}
          <View style={styles.tags}>
            {item.item_type === 'song' && context.status === 'unavailable' ? (
              <Tag label={t('orderTab.arrangementUnavailable')} accent={theme.accent.red} />
            ) : null}
            {segment !== 'service' ? (
              <Tag
                label={misplaced ? t(`orderTab.segmentBadgeMisplaced.${segment}`) : t(`orderTab.segmentBadge.${segment}`)}
                accent={misplaced ? theme.accent.yellow : theme.accent.blue}
              />
            ) : null}
          </View>
        </View>
        {item.item_type === 'song' && context.status === 'ready' ? (
          <View accessibilityLabel={`${t('orderTab.serviceKey')} ${context.displayKey ?? '—'}`}>
            <KeyCap>{context.displayKey ?? '—'}</KeyCap>
          </View>
        ) : null}
        <Text style={styles.length}>{formatDuration(item.length_seconds)}</Text>
      </PressableScale>
      {controls}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    flex: { flex: 1 },
    group: { gap: theme.space.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    warning: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, backgroundColor: theme.accent.yellow.bg, padding: theme.space.sm, borderRadius: theme.radius.sm },

    header: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.sm,
      marginTop: theme.space.lg,
      marginBottom: theme.space.xs,
    },
    headerTitle: { ...theme.type.label, color: theme.color.inkFaint },

    item: { paddingVertical: theme.space.md, gap: theme.space.sm },
    itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    lead: { alignItems: 'flex-start', minWidth: 52 },
    ordinal: { ...theme.type.numeric, color: theme.color.inkFaint },
    start: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    title: { ...theme.type.body, color: theme.color.ink },
    titleLink: { fontWeight: '600' },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    unfilled: { color: theme.accent.yellow.fg },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, marginTop: theme.space.xs },
    length: { ...theme.type.numeric, color: theme.color.inkFaint, minWidth: 46, textAlign: 'right' },
    controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: theme.space.sm },
    editControls: { flexDirection: 'row', gap: theme.space.sm, marginLeft: 'auto' },
  });

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { Chip, IconWell, KeyCap, Label, Tag } from './ui';
import { Icon, type IconName } from './icons';

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
  /** MOB-030: link or clear an F14 media bundle on a regular item (editors). */
  onMedia: (item: PlanItemDetail) => void;
  /** MOB-030: open the media bundle an item links to. */
  onOpenMedia: (mediaId: string) => void;
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
  onMedia,
  onOpenMedia,
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
      <View style={styles.summary}>
        <View style={styles.summaryLine}>
          <Icon name="clock" size={15} color={theme.color.inkFaint} />
          <Text style={styles.summaryText}>
            {[
              t('common:count.items', { count: plan.counts.items }),
              t('orderTab.inService', { duration: formatDuration(schedule.service_seconds) }),
              ...(schedule.pre_seconds > 0 ? [t('orderTab.before', { duration: formatDuration(schedule.pre_seconds) })] : []),
              ...(schedule.post_seconds > 0 ? [t('orderTab.after', { duration: formatDuration(schedule.post_seconds) })] : []),
            ].join(' · ')}
          </Text>
        </View>
        {schedule.planned_finish_at && schedule.service_starts_at ? (
          <Text style={[styles.summaryText, styles.summaryIndent]}>
            {/* The website's sentence with its emphasis markers removed. */}
            {t('orderTab.plannedFinish', {
              start: clock(schedule.service_starts_at),
              finish: clock(schedule.planned_finish_at),
              timeZone,
            }).replace(/<\/?\d>/g, '')}
          </Text>
        ) : null}
      </View>

      {serviceTimes.length > 1 ? (
        <View style={styles.group}>
          <Label>{t('orderTab.timeFor')}</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {serviceTimes.map((time) => (
              <Chip
                key={time.id}
                label={t('orderTab.serviceTimeOption', { name: time.name ?? t('timeKind.service'), time: clock(time.starts_at) })}
                active={time.id === selectedTimeId}
                onPress={() => onSelectTime(time.id)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {overrun ? (
        <View accessibilityRole="alert" style={styles.warning}>
          <Icon name="alert" size={16} color={theme.accent.yellow.fg} />
          <Text style={styles.warningText}>
            {t('orderTab.overrun', { duration: formatDuration(overrun.seconds ?? 0) })}
          </Text>
        </View>
      ) : null}
      {serviceTimes.length === 0 && plan.items.length > 0 ? (
        <View style={styles.hintRow}>
          <Icon name="info" size={15} color={theme.color.inkFaint} />
          <Text style={styles.hint}>{t('orderTab.addServiceTimeHint')}</Text>
        </View>
      ) : null}

      {plan.items.length === 0 ? (
        <View style={styles.empty}>
          <IconWell name="music" accent={theme.accent.blue} size={44} />
          <Text style={styles.emptyText}>{canEdit ? t('orderTab.emptyCanManage') : t('mobilePlan.emptyOrder')}</Text>
        </View>
      ) : (
        <View accessibilityState={{ busy }} style={styles.list}>
          {plan.items.map((item, index) => (
            <View key={item.id}>
              {index > 0 && item.item_type !== 'header' && plan.items[index - 1]?.item_type !== 'header' ? (
                <View style={styles.rowDivider} />
              ) : null}
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
                onMedia={() => onMedia(item)}
                onOpenMedia={onOpenMedia}
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
  onMedia: () => void;
  onOpenMedia: (mediaId: string) => void;
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
  onMedia,
  onOpenMedia,
  noteCount,
  onDiscuss,
  theme,
}: OrderRowProps) => {
  const { t } = useTranslation(['plans', 'messages', 'common']);
  const styles = useThemedStyles(makeStyles);

  const discuss = item.item_type !== 'header' ? (
    <PressableScale
      onPress={onDiscuss}
      accessibilityLabel={t('orderTab.notesFor', { title: item.title })}
      pressedOpacity={0.6}
      hitSlop={6}
      style={[styles.notePill, noteCount > 0 && styles.notePillActive]}
    >
      <Icon name="chat" size={14} color={noteCount > 0 ? theme.color.brandText : theme.color.inkMuted} />
      <Text style={[styles.notePillLabel, noteCount > 0 && styles.notePillLabelActive]}>
        {noteCount > 0 ? t('orderTab.noteCount', { count: noteCount }) : t('messages:itemDiscussion.discussion')}
      </Text>
    </PressableScale>
  ) : null;
  // The editing buttons stay together: on a narrow row they move below the
  // discussion button as a group instead of splitting.
  const controls = canEdit || discuss ? (
    <View style={[styles.controls, item.item_type !== 'header' && styles.controlsIndented]}>
      {discuss}
      {canEdit ? (
        <View style={styles.editControls}>
          <EditControls item={item} busy={busy} isFirst={isFirst} isLast={isLast} onEdit={onEdit} onMedia={onMedia} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
        </View>
      ) : null}
    </View>
  ) : null;
  return <OrderRowBody item={item} ordinal={ordinal} slot={slot} clock={clock} leader={leader} misplaced={misplaced} controls={controls} onOpenSong={onOpenSong} onOpenMedia={onOpenMedia} theme={theme} />;
};

interface EditControlsProps {
  item: PlanItemDetail;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  /** Regular items only: the website's per-item *Media* action. */
  onMedia: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

/** Edit / Media / Move up / Move down / Remove, for plan editors. */
const EditControls = ({ item, busy, isFirst, isLast, onEdit, onMedia, onMoveUp, onMoveDown, onRemove }: EditControlsProps) => {
  const { t } = useTranslation(['plans', 'common']);
  return (
    <>
      <RowAction name="pencil" accessibilityLabel={t('orderTab.editItem', { title: item.title })} onPress={onEdit} />
      {item.item_type === 'item' ? (
        <RowAction name="image" accessibilityLabel={t('orderTab.mediaFor', { title: item.title })} disabled={busy} onPress={onMedia} />
      ) : null}
      <RowAction name="chevronUp" accessibilityLabel={t('orderTab.moveUp', { title: item.title })} disabled={isFirst || busy} onPress={onMoveUp} />
      <RowAction name="chevronDown" accessibilityLabel={t('orderTab.moveDown', { title: item.title })} disabled={isLast || busy} onPress={onMoveDown} />
      <RowAction name="trash" danger accessibilityLabel={t('orderTab.removeItem', { title: item.title })} disabled={busy} onPress={onRemove} />
    </>
  );
};

interface RowActionProps {
  name: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /** Tints the glyph as a destructive action. */
  danger?: boolean;
}

/** A compact round glyph button for an order row; hit slop keeps a 44pt target. */
const RowAction = ({ name, accessibilityLabel, onPress, disabled = false, danger = false }: RowActionProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      pressedOpacity={0.5}
      hitSlop={4}
      style={[styles.rowAction, disabled && styles.rowActionDisabled]}
    >
      <Icon name={name} size={17} color={danger ? theme.accent.red.fg : theme.color.inkMuted} />
    </PressableScale>
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
  onOpenMedia: (mediaId: string) => void;
  theme: Theme;
}

const OrderRowBody = ({ item, ordinal, slot, clock, leader, misplaced, controls, onOpenSong, onOpenMedia, theme }: OrderRowBodyProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const styles = useThemedStyles(makeStyles);

  if (item.item_type === 'header') {
    return (
      <View style={styles.header}>
        <View style={styles.headerLabel}>
          <Text accessibilityRole="header" style={styles.headerTitle}>{item.title}</Text>
          <View style={styles.headerRule} />
        </View>
        {controls}
      </View>
    );
  }

  const context = resolvePlanItemChartContext(item);
  const segment = item.service_segment ?? 'service';
  const isSong = item.item_type === 'song';

  return (
    <View style={styles.item}>
      <PressableScale disabled={!item.song} onPress={onOpenSong} pressedOpacity={0.6} style={styles.itemTop}>
        <View style={styles.lead}>
          <Text maxFontSizeMultiplier={1.3} style={styles.start}>{slot ? clock(slot.starts_at) : '—'}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.ordinal}>{String(ordinal ?? 0).padStart(2, '0')}</Text>
        </View>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            {isSong ? <Icon name="music" size={14} color={theme.color.brandText} /> : null}
            <Text style={[styles.title, item.song ? styles.titleLink : null]}>{item.title}</Text>
          </View>
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
            <View style={styles.leaderRow}>
              <Icon name="person" size={13} color={leader.unfilled ? theme.accent.yellow.fg : theme.color.inkFaint} />
              <Text style={[styles.leader, leader.unfilled && styles.unfilled]}>{t('orderTab.ledBy', { leader: leader.text })}</Text>
            </View>
          ) : null}
          {item.media ? (
            <Text
              accessibilityRole="link"
              onPress={() => item.media && onOpenMedia(item.media.id)}
              style={[styles.meta, styles.mediaLink]}
            >
              {t(item.media.archived ? 'orderTab.mediaLinkArchived' : 'orderTab.mediaLink', { title: item.media.title }).replace(/<\/?\d>/g, '')}
            </Text>
          ) : null}
          {(isSong && context.status === 'unavailable') || segment !== 'service' ? (
            <View style={styles.tags}>
              {isSong && context.status === 'unavailable' ? (
                <Tag label={t('orderTab.arrangementUnavailable')} accent={theme.accent.red} />
              ) : null}
              {segment !== 'service' ? (
                <Tag
                  label={misplaced ? t(`orderTab.segmentBadgeMisplaced.${segment}`) : t(`orderTab.segmentBadge.${segment}`)}
                  accent={misplaced ? theme.accent.yellow : theme.accent.blue}
                />
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.trail}>
          {isSong && context.status === 'ready' ? (
            <View accessibilityLabel={`${t('orderTab.serviceKey')} ${context.displayKey ?? '—'}`}>
              <KeyCap>{context.displayKey ?? '—'}</KeyCap>
            </View>
          ) : null}
          <Text maxFontSizeMultiplier={1.3} style={styles.length}>{formatDuration(item.length_seconds)}</Text>
        </View>
      </PressableScale>
      {controls}
    </View>
  );
};

const LEAD_WIDTH = 58;

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.md },
    flex: { flex: 1 },
    group: { gap: theme.space.sm },
    chips: { flexDirection: 'row', gap: theme.space.sm },

    summary: { gap: 2 },
    summaryLine: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    summaryText: { ...theme.type.bodySmall, color: theme.color.inkMuted, flexShrink: 1 },
    summaryIndent: { marginLeft: 15 + theme.space.sm },
    hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint, flex: 1 },
    warning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.sm,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
    },
    warningText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, flex: 1 },
    empty: { alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.xl },
    emptyText: { ...theme.type.bodySmall, color: theme.color.inkMuted, textAlign: 'center', maxWidth: 300 },

    list: { marginTop: -theme.space.xs },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border,
      marginLeft: LEAD_WIDTH + theme.space.md,
    },

    header: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.space.sm,
      marginHorizontal: -theme.space.lg,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
      marginTop: theme.space.sm,
      backgroundColor: theme.color.surfaceInset,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border,
    },
    headerLabel: { flexGrow: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, minHeight: 28 },
    headerTitle: { ...theme.type.eyebrow, color: theme.color.brandText, flexShrink: 1 },
    headerRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.color.borderStrong },

    item: { paddingVertical: theme.space.md, gap: theme.space.sm },
    itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    lead: { width: LEAD_WIDTH, gap: 2 },
    start: { ...theme.type.numeric, fontSize: 14, lineHeight: 22, fontWeight: '600', color: theme.color.ink },
    ordinal: { ...theme.type.numeric, fontSize: 12, lineHeight: 16, color: theme.color.inkFaint },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { ...theme.type.body, color: theme.color.ink, flexShrink: 1 },
    titleLink: { fontWeight: '600' },
    mediaLink: { color: theme.color.brandText, fontWeight: '500' },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
    leader: { ...theme.type.label, fontSize: 12.5, color: theme.color.inkMuted, flexShrink: 1 },
    unfilled: { color: theme.accent.yellow.fg },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, marginTop: theme.space.sm },
    trail: { alignItems: 'flex-end', gap: 6, minWidth: 46 },
    length: { ...theme.type.numeric, fontSize: 12.5, lineHeight: 22, color: theme.color.inkMuted, textAlign: 'right' },

    controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: theme.space.sm },
    controlsIndented: { marginLeft: LEAD_WIDTH + theme.space.md },
    editControls: { flexDirection: 'row', gap: theme.space.sm, marginLeft: 'auto' },
    rowAction: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.surfaceInset,
    },
    rowActionDisabled: { opacity: 0.35 },
    notePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 32,
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border,
    },
    notePillActive: { backgroundColor: theme.accent.blue.bg, borderColor: theme.accent.blue.bg },
    notePillLabel: { ...theme.type.label, fontSize: 12.5, color: theme.color.inkMuted },
    notePillLabelActive: { color: theme.color.brandText, fontWeight: '600' },
  });

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { SONG_USAGE_WINDOW_WEEKS, songLibraryBpm, songLibraryKeys, type SongListItem } from '@service-center/shared';
import { RECENT_USE_WARNING_DAYS, songAge, type SongAge } from '../../lib/song-browser';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { useFormatters } from '../../i18n';
import { Icon } from '../icons';
import { PressableScale } from '../motion';
import { KeyCap } from '../ui';

/** How the row shows whether the song is already in the plan. */
export type SongRowPlanState =
  /** Not in the plan. */
  | 'none'
  /** The server marked it in this plan (`in_plan`). */
  | 'inPlan'
  /** Added during this visit. */
  | 'added';

export interface SongBrowserRowProps {
  song: SongListItem;
  planState: SongRowPlanState;
  /** Soft warning: sung within two weeks of the plan date (never shown with a plan mark). */
  recentlyUsed: boolean;
  /** ISO instant the browser opened, for "last used 3 weeks ago". */
  now: string;
  /** This row's add is being sent. */
  adding: boolean;
  /** Another add is being sent: wait for it. */
  disabled: boolean;
  onAdd: () => void;
}

/**
 * One song in the plan's song browser: what the choice needs (key, tempo,
 * author, how often and how recently it was used) and a one-tap [+].
 */
export const SongBrowserRow = ({ song, planState, recentlyUsed, now, adding, disabled, onAdd }: SongBrowserRowProps) => {
  const { t } = useTranslation(['plans', 'songs']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const usage = useSongUsageText(song, now);
  const keys = songLibraryKeys(song);
  const bpm = songLibraryBpm(song);
  const marked = planState !== 'none';
  const detail = [song.author, bpm ? t('songs:arrangement.bpmValue', { bpm }) : null].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{song.title}</Text>
        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
        <Text style={styles.usage} numberOfLines={2}>{usage}</Text>
        {marked ? (
          <View style={styles.badgeRow}>
            <Icon name="check" size={13} color={theme.accent.green.fg} strokeWidth={2.6} />
            <Text style={styles.inPlan}>{planState === 'added' ? t('mobileSongBrowser.added') : t('mobileSongBrowser.inPlan')}</Text>
          </View>
        ) : recentlyUsed ? (
          <View style={styles.badgeRow}>
            <Icon name="alert" size={13} color={theme.accent.yellow.fg} />
            <Text style={styles.warning}>{t('mobileSongBrowser.recentWarning', { count: RECENT_USE_WARNING_DAYS })}</Text>
          </View>
        ) : null}
      </View>
      {keys ? <KeyCap>{keys}</KeyCap> : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={adding ? t('mobileSongBrowser.adding', { title: song.title }) : t('mobileSongBrowser.addSong', { title: song.title })}
        accessibilityState={{ busy: adding }}
        disabled={disabled || adding}
        onPress={onAdd}
        pressedOpacity={0.6}
        hitSlop={4}
        style={[styles.add, marked && styles.addMarked, disabled && !adding && styles.addDisabled]}
      >
        {adding ? (
          <ActivityIndicator size="small" color={theme.color.onBrand} />
        ) : (
          <Icon name={marked ? 'check' : 'plus'} size={18} color={marked ? theme.accent.green.fg : theme.color.onBrand} strokeWidth={2.4} />
        )}
      </PressableScale>
    </View>
  );
};

export interface SongPickRowProps {
  song: SongListItem;
  /** The song the item uses now. */
  chosen: boolean;
  onPress: () => void;
}

/** The same row, compact: a tap chooses the song (Edit item's "Change song"). */
export const SongPickRow = ({ song, chosen, onPress }: SongPickRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const keys = songLibraryKeys(song);
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={[song.title, song.author, keys].filter(Boolean).join(', ')}
      onPress={onPress}
      pressedOpacity={0.6}
      style={[styles.pickRow, chosen && styles.pickRowOn]}
    >
      <View style={styles.body}>
        <Text style={[styles.pickTitle, chosen && styles.pickTitleOn]} numberOfLines={1}>{song.title}</Text>
        {song.author ? <Text style={styles.detail} numberOfLines={1}>{song.author}</Text> : null}
      </View>
      {keys ? <KeyCap>{keys}</KeyCap> : null}
      {chosen ? <Icon name="check" size={16} color={theme.accent.blue.fg} strokeWidth={2.6} /> : null}
    </PressableScale>
  );
};

/** "Used 5× in 12 weeks · last used 2 weeks ago", or "Never scheduled". */
const useSongUsageText = (song: SongListItem, now: string): string => {
  const { t } = useTranslation('plans');
  const format = useFormatters();
  if (!song.last_scheduled_at) return t('mobileSongBrowser.neverUsed');
  const weeks = SONG_USAGE_WINDOW_WEEKS;
  const count = song.usage_count > 0
    ? t('mobileSongBrowser.usedCount', { count: song.usage_count, weeks })
    : t('mobileSongBrowser.notUsedRecently', { weeks });
  const age = songAge(song.last_scheduled_at, now);
  return `${count} · ${ageText(age, song.last_scheduled_at, t, format.date)}`;
};

const ageText = (age: SongAge, lastScheduledAt: string, t: TFunction<'plans'>, date: (value: string) => string): string => {
  switch (age.unit) {
    case 'today':
      return t('mobileSongBrowser.lastUsed.today');
    case 'upcoming':
      return t('mobileSongBrowser.lastUsed.upcoming', { date: date(lastScheduledAt) });
    case 'days':
      return t('mobileSongBrowser.lastUsed.days', { count: age.count });
    case 'weeks':
      return t('mobileSongBrowser.lastUsed.weeks', { count: age.count });
    case 'months':
      return t('mobileSongBrowser.lastUsed.months', { count: age.count });
    case 'years':
      return t('mobileSongBrowser.lastUsed.years', { count: age.count });
  }
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border,
    },
    body: { flex: 1, gap: 2 },
    title: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    detail: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    usage: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    inPlan: { ...theme.type.bodySmall, fontWeight: '600', color: theme.accent.green.fg },
    warning: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, flexShrink: 1 },
    add: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.brand,
    },
    addMarked: { backgroundColor: theme.accent.green.bg },
    addDisabled: { opacity: 0.4 },
    pickRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },
    pickRowOn: { backgroundColor: theme.accent.blue.bg },
    pickTitle: { ...theme.type.body, color: theme.color.ink },
    pickTitleOn: { fontWeight: '600', color: theme.accent.blue.fg },
  });

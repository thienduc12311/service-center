import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PlanTimeKind, ServiceCenterAccentName } from '@service-center/shared';
import { Icon, type IconName } from './icons';
import { IconWell } from './ui';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { useFormatters } from '../i18n';

/**
 * Presentation pieces shared by the Open positions (MOB-009) and Replacements
 * (MOB-010) screens, so required times, states and progress read at a glance
 * instead of as plain sentences.
 */

/** One time someone would have to be there. */
export interface TimeSlot {
  id: string;
  name: string | null;
  kind: PlanTimeKind;
  starts_at: string;
  ends_at: string;
}

const KIND_ACCENT: Partial<Record<PlanTimeKind, ServiceCenterAccentName>> = { rehearsal: 'yellow', service: 'blue' };

export interface TimeSlotListProps {
  times: readonly TimeSlot[];
  /** Shown instead of the list when there are no times. */
  emptyText: string;
}

/** Each time as its own row: a colored kind icon, the bold name, then date and time range. */
export const TimeSlotList = ({ times, emptyText }: TimeSlotListProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('reports');
  const format = useFormatters();
  if (times.length === 0) return <Text style={styles.muted}>{emptyText}</Text>;
  return (
    <View style={styles.slots}>
      {times.map((time) => {
        const accent = theme.accent[KIND_ACCENT[time.kind] ?? 'neutral'];
        const name = time.name || t(`attendance.timeKinds.${time.kind}`);
        return (
          <View
            key={time.id}
            style={styles.slot}
            accessible
            accessibilityLabel={`${name}, ${format.date(time.starts_at, 'short')}, ${format.time(time.starts_at)}–${format.time(time.ends_at)}`}
          >
            <IconWell name="calendar" accent={accent} size={40} />
            <View style={styles.slotText}>
              <Text style={styles.slotName}>{name}</Text>
              <Text style={styles.slotDate}>{format.date(time.starts_at, 'short')}</Text>
              <Text style={[styles.slotTime, { color: accent.fg }]}>{`${format.time(time.starts_at)} – ${format.time(time.ends_at)}`}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

export interface StatusBannerProps {
  accent: ServiceCenterAccentName;
  icon: IconName;
  title: string;
  body?: string | null;
  children?: ReactNode;
  /** Announce changes (results of an action) to screen readers. */
  live?: boolean;
}

/** A tinted callout: icon, bold title, optional explanation and actions. */
export const StatusBanner = ({ accent, icon, title, body, children, live = false }: StatusBannerProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const colors = theme.accent[accent];
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.bg, borderColor: colors.fg }]}
      accessibilityLiveRegion={live ? 'polite' : undefined}
    >
      <View style={styles.bannerTop}>
        <Icon name={icon} size={20} color={colors.fg} />
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: colors.fg }]}>{title}</Text>
          {body ? <Text style={styles.bannerBody}>{body}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
};

export interface MetaLineProps {
  icon: IconName;
  children: string;
  /** Emphasize (e.g. a deadline). */
  strong?: boolean;
}

/** A small icon followed by one line of detail. */
export const MetaLine = ({ icon, children, strong = false }: MetaLineProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={15} color={theme.color.inkFaint} />
      <Text style={[styles.metaText, strong && styles.metaStrong]}>{children}</Text>
    </View>
  );
};

export interface ProgressStep {
  label: string;
  done: boolean;
}

/** Steps that must all be done, as checked or open pills (e.g. "Agreed", "Leader approved"). */
export const StepPills = ({ steps }: { steps: readonly ProgressStep[] }) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.steps}>
      {steps.map((step) => {
        const colors = step.done ? theme.accent.green : theme.accent.neutral;
        return (
          <View
            key={step.label}
            style={[styles.step, { backgroundColor: colors.bg }]}
            accessible
            accessibilityLabel={`${step.label}: ${step.done ? '✓' : '—'}`}
          >
            <Icon name={step.done ? 'check' : 'minus'} size={13} color={colors.fg} />
            <Text style={[styles.stepLabel, { color: colors.fg }]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    slots: { gap: theme.space.md },
    slot: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    slotText: { flex: 1, gap: 1 },
    slotName: { ...theme.type.heading, color: theme.color.ink },
    slotDate: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    slotTime: { ...theme.type.label, fontWeight: '600' },
    banner: {
      gap: theme.space.md,
      padding: theme.space.lg,
      borderRadius: theme.radius.lg,
      borderLeftWidth: 4,
      borderTopWidth: 0,
      borderRightWidth: 0,
      borderBottomWidth: 0,
    },
    bannerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    bannerText: { flex: 1, gap: theme.space.xs },
    bannerTitle: { ...theme.type.heading },
    bannerBody: { ...theme.type.bodySmall, color: theme.color.ink },
    meta: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    metaText: { ...theme.type.bodySmall, color: theme.color.inkMuted, flex: 1 },
    metaStrong: { color: theme.color.ink, fontWeight: '600' },
    steps: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.xs,
      paddingHorizontal: theme.space.sm,
      paddingVertical: 3,
      borderRadius: theme.radius.pill,
    },
    stepLabel: { ...theme.type.label },
  });

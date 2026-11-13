import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from './motion';
import { useTranslation } from 'react-i18next';
import type { AssignmentDetail } from '@service-center/shared';
import { Avatar, Button, Card, EmptyState, IconWell, ListRow, Tag } from './ui';
import { Icon, type IconName } from './icons';
import {
  MAX_POSITION_NEED,
  visiblePositions,
  type PlanTeamPositionView,
  type PlanTeamView,
} from '../lib/plan-teams';
import { statusAccent, type Accent, type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';

/**
 * MOB-008 Pass A: the plan's Teams view, matching the website Teams tab —
 * per-team counts, positions as staffed/needed, and the "Needed positions"
 * editor that saves each step as it goes.
 */
export interface PlanTeamsProps {
  teams: PlanTeamView[];
  /** scheduling.manage for this team on this plan (F01 scope). */
  canScheduleTeam: (teamId: string) => boolean;
  /** plans.edit: may change needed positions on every team. */
  canEditPlan: boolean;
  editingNeeds: boolean;
  onEditingNeedsChange: (editing: boolean) => void;
  onNeedChange: (positionId: string, needed: number) => void;
  /** The position whose need is being saved, so its stepper waits. */
  savingPositionId: string | null;
  showAllTeams: boolean;
  onToggleAllTeams: () => void;
  /** Opens "Schedule people" (website: Add people). */
  onAddPeople: () => void;
  /** Opens this plan's signup openings (website: the Teams tab's open positions panel). */
  onOpenPositions: () => void;
}

export const PlanTeams = ({
  teams,
  canScheduleTeam,
  canEditPlan,
  editingNeeds,
  onEditingNeedsChange,
  onNeedChange,
  savingPositionId,
  showAllTeams,
  onToggleAllTeams,
  onAddPeople,
  onOpenPositions,
}: PlanTeamsProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const canEditAnyNeeds = canEditPlan || teams.some((team) => canScheduleTeam(team.team.id));

  return (
    <View style={styles.wrap}>
      {canEditAnyNeeds ? (
        editingNeeds ? (
          <Button title={t('common:actions.done')} icon="check" onPress={() => onEditingNeedsChange(false)} />
        ) : (
          <View style={styles.actions}>
            <Button
              variant="secondary"
              icon="plus"
              title={t('teamsTab.addPeople')}
              onPress={onAddPeople}
              style={styles.grow}
            />
            <Button
              variant="secondary"
              icon="pencil"
              title={t('teamsTab.neededPositions')}
              onPress={() => onEditingNeedsChange(true)}
              style={styles.grow}
            />
          </View>
        )
      ) : null}

      <Card compact>
        <ListRow
          showChevron
          onPress={onOpenPositions}
          leading={<IconWell name="sparkle" accent={theme.accent.green} size={36} />}
        >
          <Text style={styles.hintTitle}>{t('openPositions.planEntry')}</Text>
        </ListRow>
        <ListRow
          divided
          onPress={onToggleAllTeams}
          leading={<IconWell name="people" accent={theme.accent.neutral} size={36} />}
        >
          <Text style={styles.toggleLabel}>
            {showAllTeams ? t('teamsTab.showServiceTeams') : t('teamsTab.showAllTeams')}
          </Text>
        </ListRow>
      </Card>

      {editingNeeds ? (
        <View style={styles.editHint}>
          <Icon name="info" size={17} color={theme.accent.blue.fg} />
          <View style={styles.flex}>
            <Text style={styles.editHintTitle}>{t('teamsTab.editNeedsTitle')}</Text>
            {/* The website hint's <0> marks "Done"; native shows it as plain text. */}
            <Text style={styles.editHintBody}>{t('teamsTab.editNeedsHint').replace(/<\/?0>/g, '')}</Text>
          </View>
        </View>
      ) : null}

      {teams.length === 0 ? (
        <EmptyState icon="people" title={t('teamsTab.emptyTitle')} description={t('teamsTab.emptyDescription')} />
      ) : (
        teams.map((team) => (
          <TeamCard
            key={team.team.id}
            team={team}
            canEditNeeds={canEditPlan || canScheduleTeam(team.team.id)}
            editingNeeds={editingNeeds}
            onNeedChange={onNeedChange}
            savingPositionId={savingPositionId}
          />
        ))
      )}
    </View>
  );
};

interface TeamCardProps {
  team: PlanTeamView;
  canEditNeeds: boolean;
  editingNeeds: boolean;
  onNeedChange: (positionId: string, needed: number) => void;
  savingPositionId: string | null;
}

const TeamCard = ({ team, canEditNeeds, editingNeeds, onNeedChange, savingPositionId }: TeamCardProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const positions = visiblePositions(team, editingNeeds);

  return (
    <Card compact style={styles.teamCard}>
      <View style={styles.teamHeader}>
        <View style={styles.teamWell}>
          <View style={[styles.dot, { backgroundColor: team.team.color }]} />
        </View>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.teamName}>{team.team.name}</Text>
          <View style={styles.counts}>
            <CountBadge glyph="check" label={t('common:assignmentStatus.confirmed')} value={team.confirmed} accent={statusAccent(theme, 'confirmed')} />
            <CountBadge glyph="close" label={t('common:assignmentStatus.declined')} value={team.declined} accent={statusAccent(theme, 'declined')} />
            <CountBadge glyph="clock" label={t('common:assignmentStatus.unconfirmed')} value={team.pending} accent={statusAccent(theme, 'unconfirmed')} />
            {team.prepared.length ? (
              <Tag label={t('teamsTab.preparedCount', { count: team.prepared.length })} accent={theme.accent.neutral} />
            ) : null}
          </View>
        </View>
      </View>

      {team.positions.length === 0 && team.unpositioned.length === 0 ? (
        <Text style={styles.empty}>{t('teamsTab.noPositions')}</Text>
      ) : positions.length === 0 && team.unpositioned.length === 0 ? (
        <Text style={styles.empty}>{t('teamsTab.nothingNeeded')}</Text>
      ) : (
        <View>
          {positions.map((position) => (
            <PositionBlock
              key={position.position.id}
              position={position}
              canEditNeeds={canEditNeeds}
              editingNeeds={editingNeeds}
              saving={savingPositionId === position.position.id}
              onNeedChange={onNeedChange}
            />
          ))}
          {team.unpositioned.length ? (
            <View style={styles.position}>
              <View style={styles.positionHeader}>
                <Text style={styles.positionName}>{t('teamsTab.noPosition')}</Text>
              </View>
              {team.unpositioned.map((assignment) => (
                <ScheduledPerson key={assignment.id} assignment={assignment} />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
};

interface CountBadgeProps {
  glyph: IconName;
  /** The status the count is of, read by screen readers. */
  label: string;
  value: number;
  accent: Accent;
}

/** A response count (confirmed / declined / pending) as a small tinted pill. */
const CountBadge = ({ glyph, label, value, accent }: CountBadgeProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.countBadge, { backgroundColor: accent.bg }]}>
      <Icon name={glyph} size={12} color={accent.fg} strokeWidth={2.4} />
      <Text style={[styles.countBadgeLabel, { color: accent.fg }]}>{value}</Text>
    </View>
  );
};

interface PositionBlockProps {
  position: PlanTeamPositionView;
  canEditNeeds: boolean;
  editingNeeds: boolean;
  saving: boolean;
  onNeedChange: (positionId: string, needed: number) => void;
}

const PositionBlock = ({ position, canEditNeeds, editingNeeds, saving, onNeedChange }: PositionBlockProps) => {
  const { t } = useTranslation('staffing');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const filled = position.scheduled.length >= position.needed;

  return (
    <View style={styles.position}>
      <View style={styles.positionHeader}>
        <Text style={styles.positionName}>
          {position.position.name}
          {position.planOnly ? ` ${t('teamsTab.planOnlySuffix')}` : ''}
        </Text>
        {!editingNeeds && position.needed > 0 ? (
          <Tag
            label={t('teamsTab.staffedOfNeeded', { scheduled: position.scheduled.length, needed: position.needed })}
            accent={filled ? theme.accent.green : theme.accent.yellow}
          />
        ) : null}
      </View>

      {editingNeeds ? (
        <View style={styles.stepperRow}>
          <Text style={styles.muted}>{t('teamsTab.scheduledCount', { count: position.scheduled.length })}</Text>
          <View style={styles.stepper}>
            <Text style={styles.muted}>{t('teamsTab.needed')}</Text>
            <StepButton
              glyph="minus"
              accessibilityLabel={t('teamsTab.oneFewer', { position: position.position.name })}
              disabled={!canEditNeeds || saving || position.needed === 0}
              onPress={() => onNeedChange(position.position.id, position.needed - 1)}
            />
            <Text accessibilityLiveRegion="polite" style={styles.needed}>{position.needed}</Text>
            <StepButton
              glyph="plus"
              accessibilityLabel={t('teamsTab.oneMore', { position: position.position.name })}
              disabled={!canEditNeeds || saving || position.needed >= MAX_POSITION_NEED}
              onPress={() => onNeedChange(position.position.id, position.needed + 1)}
            />
          </View>
        </View>
      ) : null}

      {position.scheduled.map((assignment) => (
        <ScheduledPerson key={assignment.id} assignment={assignment} />
      ))}
    </View>
  );
};

interface StepButtonProps {
  glyph: IconName;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}

const StepButton = ({ glyph, accessibilityLabel, disabled, onPress }: StepButtonProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      pressedOpacity={0.6}
      style={[styles.stepButton, disabled && styles.stepDisabled]}
    >
      <Icon name={glyph} size={18} color={theme.color.ink} strokeWidth={2.2} />
    </PressableScale>
  );
};

interface ScheduledPersonProps {
  assignment: AssignmentDetail;
}

const ScheduledPerson = ({ assignment }: ScheduledPersonProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const name = assignment.person?.full_name ?? assignment.person?.email ?? t('common:states.unknown');
  const prepared = assignment.visibility === 'prepared';

  return (
    <View style={styles.person}>
      <Avatar name={name} url={assignment.person?.avatar_url} size={34} />
      <Text style={[styles.personName, styles.flex]} numberOfLines={1}>{name}</Text>
      {prepared ? (
        <Tag label={t('teamsTab.prepared')} accent={theme.accent.neutral} />
      ) : (
        <Tag
          label={t(`common:assignmentStatus.${assignment.status}`)}
          accent={statusAccent(theme, assignment.status)}
        />
      )}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    grow: { flexGrow: 1 },
    wrap: { gap: theme.space.md },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hintTitle: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    toggleLabel: { ...theme.type.body, color: theme.color.brandText, fontWeight: '500' },
    editHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.space.sm,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.accent.blue.bg,
    },
    editHintTitle: { ...theme.type.bodySmall, fontWeight: '600', color: theme.accent.blue.fg },
    editHintBody: { ...theme.type.bodySmall, color: theme.accent.blue.fg },
    empty: { ...theme.type.bodySmall, color: theme.color.inkFaint, textAlign: 'center', paddingVertical: theme.space.lg },

    teamCard: { paddingHorizontal: theme.space.lg },
    teamHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md, paddingBottom: theme.space.xs },
    teamWell: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: { width: 14, height: 14, borderRadius: 7 },
    teamName: { ...theme.type.heading, color: theme.color.ink },
    counts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
    countBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: theme.radius.pill,
    },
    countBadgeLabel: { ...theme.type.numeric, fontSize: 12, lineHeight: 16, fontWeight: '600' },

    position: {
      marginTop: theme.space.md,
      paddingTop: theme.space.md,
      gap: theme.space.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },
    positionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.sm,
      marginBottom: theme.space.xs,
    },
    positionName: { ...theme.type.eyebrow, color: theme.color.inkFaint, flexShrink: 1 },
    stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    stepButton: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surfaceInset,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDisabled: { opacity: 0.3 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    needed: { ...theme.type.numeric, fontSize: 17, lineHeight: 22, fontWeight: '600', color: theme.color.ink, minWidth: 28, textAlign: 'center' },
    person: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 44, paddingVertical: 4 },
    personName: { ...theme.type.body, color: theme.color.ink },
  });

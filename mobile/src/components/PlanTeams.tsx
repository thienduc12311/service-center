import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from './motion';
import { useTranslation } from 'react-i18next';
import type { AssignmentDetail } from '@service-center/shared';
import { Avatar, Button, Card, EmptyState, ListRow, Tag } from './ui';
import {
  MAX_POSITION_NEED,
  visiblePositions,
  type PlanTeamPositionView,
  type PlanTeamView,
} from '../lib/plan-teams';
import { statusAccent, type Theme } from '../lib/theme';
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
  const styles = useThemedStyles(makeStyles);
  const canEditAnyNeeds = canEditPlan || teams.some((team) => canScheduleTeam(team.team.id));

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <Button
          variant="quiet"
          title={showAllTeams ? t('teamsTab.showServiceTeams') : t('teamsTab.showAllTeams')}
          onPress={onToggleAllTeams}
        />
        {canEditAnyNeeds ? (
          editingNeeds ? (
            <Button title={t('common:actions.done')} onPress={() => onEditingNeedsChange(false)} />
          ) : (
            <View style={styles.actions}>
              <Button
                variant="secondary"
                title={t('teamsTab.neededPositions')}
                onPress={() => onEditingNeedsChange(true)}
              />
              <Button variant="secondary" title={t('teamsTab.addPeople')} onPress={onAddPeople} />
            </View>
          )
        ) : null}
      </View>

      <Card compact>
        <ListRow showChevron onPress={onOpenPositions}>
          <Text style={styles.hintTitle}>{t('openPositions.planEntry')}</Text>
        </ListRow>
      </Card>

      {editingNeeds ? (
        <Card compact>
          <Text style={styles.hintTitle}>{t('teamsTab.editNeedsTitle')}</Text>
          {/* The website hint's <0> marks "Done"; native shows it as plain text. */}
          <Text style={styles.muted}>{t('teamsTab.editNeedsHint').replace(/<\/?0>/g, '')}</Text>
        </Card>
      ) : null}

      {teams.length === 0 ? (
        <EmptyState title={t('teamsTab.emptyTitle')} description={t('teamsTab.emptyDescription')} />
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
    <Card>
      <View style={styles.teamHeader}>
        <View style={[styles.dot, { backgroundColor: team.team.color }]} />
        <Text style={styles.teamName}>{team.team.name}</Text>
      </View>
      <View style={styles.counts}>
        <Tag label={`✓ ${team.confirmed}`} accent={statusAccent(theme, 'confirmed')} />
        <Tag label={`✕ ${team.declined}`} accent={statusAccent(theme, 'declined')} />
        <Tag label={`? ${team.pending}`} accent={statusAccent(theme, 'unconfirmed')} />
        {team.prepared.length ? (
          <Tag label={t('teamsTab.preparedCount', { count: team.prepared.length })} accent={theme.accent.neutral} />
        ) : null}
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
            <View>
              <Text style={styles.positionName}>{t('teamsTab.noPosition')}</Text>
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
          <Text style={[styles.ratio, { color: filled ? theme.accent.green.fg : theme.accent.yellow.fg }]}>
            {t('teamsTab.staffedOfNeeded', { scheduled: position.scheduled.length, needed: position.needed })}
          </Text>
        ) : null}
      </View>

      {editingNeeds ? (
        <View style={styles.stepperRow}>
          <Text style={styles.muted}>{t('teamsTab.scheduledCount', { count: position.scheduled.length })}</Text>
          <View style={styles.stepper}>
            <Text style={styles.muted}>{t('teamsTab.needed')}</Text>
            <StepButton
              label="−"
              accessibilityLabel={t('teamsTab.oneFewer', { position: position.position.name })}
              disabled={!canEditNeeds || saving || position.needed === 0}
              onPress={() => onNeedChange(position.position.id, position.needed - 1)}
            />
            <Text accessibilityLiveRegion="polite" style={styles.needed}>{position.needed}</Text>
            <StepButton
              label="+"
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
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}

const StepButton = ({ label, accessibilityLabel, disabled, onPress }: StepButtonProps) => {
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
      <Text style={styles.stepLabel}>{label}</Text>
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
      <Avatar name={name} size={32} />
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
    wrap: { gap: theme.space.lg },
    toolbar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.sm,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hintTitle: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    empty: { ...theme.type.bodySmall, color: theme.color.inkFaint, textAlign: 'center', paddingVertical: theme.space.lg },
    teamHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    dot: { width: 10, height: 10, borderRadius: 5 },
    teamName: { ...theme.type.heading, color: theme.color.ink },
    counts: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.sm },
    position: { marginTop: theme.space.md, gap: theme.space.sm },
    positionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    positionName: { ...theme.type.label, color: theme.color.inkMuted },
    ratio: { ...theme.type.numeric },
    stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    stepButton: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDisabled: { opacity: 0.3 },
    stepLabel: { ...theme.type.heading, color: theme.color.ink },
    needed: { ...theme.type.numeric, color: theme.color.ink, minWidth: 24, textAlign: 'center' },
    person: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    personName: { ...theme.type.body, color: theme.color.ink },
  });

import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fileAudiencesFor, type FileOwnerKind } from '@service-center/shared';
import type { FileAudienceValue } from '../../lib/file-view';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { useAuth } from '../../providers/AuthProvider';
import { Chip, ErrorNotice, Label, Loading } from '../ui';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';


export interface AudiencePickerProps {
  ownerKind: FileOwnerKind;
  value: FileAudienceValue;
  onChange: (value: FileAudienceValue) => void;
  /** Plan-only positions of this plan may be chosen too. */
  planId: string | null;
}

const toggle = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((value) => value !== id) : [...list, id];


/** MOB-026: the website's `AudienceFields` with native chips. The database revalidates every id. */
export const AudiencePicker = ({ ownerKind, value, onChange, planId }: AudiencePickerProps) => {
  const { t } = useTranslation('media');
  const { queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const needsTeams = value.audience === 'teams' || value.audience === 'positions';
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope && needsTeams),
  });

  return (
    <View style={styles.wrap}>
      <Label>{t('audience.legend')}</Label>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {fileAudiencesFor(ownerKind).map((audience) => (
          <Chip
            key={audience}
            label={t(`files.audiences.${audience}`)}
            active={value.audience === audience}
            onPress={() => onChange({ ...value, audience })}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        {ownerKind === 'song' || ownerKind === 'arrangement' ? t('audience.songLeaders') : t('audience.planLeaders')}
        {value.audience === 'scheduled' ? ` ${t('audience.scheduledHint')}` : ''}
      </Text>

      {needsTeams && teams.isLoading ? (
        <Loading label={value.audience === 'teams' ? t('audience.loadingTeams') : t('audience.loadingPositions')} />
      ) : null}
      <ErrorNotice error={needsTeams ? teams.error : null} />

      {value.audience === 'teams' ? (
        <View style={styles.chips}>
          {(teams.data ?? []).map((team) => (
            <Chip
              key={team.id}
              toggle
              label={team.name}
              active={value.teamIds.includes(team.id)}
              onPress={() => onChange({ ...value, teamIds: toggle(value.teamIds, team.id) })}
            />
          ))}
        </View>
      ) : null}

      {value.audience === 'positions'
        ? (teams.data ?? []).map((team) => {
            const positions = team.positions.filter((position) => position.plan_id === null || position.plan_id === planId);
            if (!positions.length) return null;
            return (
              <View key={team.id} style={styles.group}>
                <Text style={styles.groupTitle}>{team.name}</Text>
                <View style={styles.chips}>
                  {positions.map((position) => (
                    <Chip
                      key={position.id}
                      toggle
                      label={position.name}
                      active={value.positionIds.includes(position.id)}
                      onPress={() => onChange({ ...value, positionIds: toggle(value.positionIds, position.id) })}
                    />
                  ))}
                </View>
              </View>
            );
          })
        : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    group: { gap: theme.space.xs },
    groupTitle: { ...theme.type.label, color: theme.color.inkMuted },
  });

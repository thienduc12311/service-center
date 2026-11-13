import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  externalLinkTokenSchema,
  type AssignmentRespondPreview,
  type AssignmentRespondResult,
} from '@service-center/shared';
import { api } from '../src/lib/api';
import {
  assignmentResponseFailure,
  type AssignmentResponseFailure,
} from '../src/lib/assignment-response-state';
import { Button, Card, DateBadge, IconWell, Loading, Screen, ScreenHeader, Tag } from '../src/components/ui';
import { Icon } from '../src/components/icons';
import { Reveal } from '../src/components/motion';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';
import { statusAccent, type Theme } from '../src/lib/theme';
import { useFormatters, useRecipientLanguage } from '../src/i18n';

type Stage = 'loading' | 'ready' | 'submitting' | 'success' | AssignmentResponseFailure;

const FAILURE_MESSAGE_KEY = {
  invalid: 'respond.failures.invalid',
  expired: 'respond.failures.expired',
  used: 'respond.failures.used',
  stale: 'respond.failures.stale',
  network: 'respond.failures.network',
} as const satisfies Record<AssignmentResponseFailure, string>;

/** Public, token-scoped response flow; no account or full plan access is required. */
export default function RespondScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const parsedToken = externalLinkTokenSchema.safeParse(params.token);
  const token = parsedToken.success ? parsedToken.data : null;
  const router = useRouter();
  const { t } = useTranslation(['auth', 'common']);
  const fmt = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [stage, setStage] = useState<Stage>(token ? 'loading' : 'invalid');
  const [preview, setPreview] = useState<AssignmentRespondPreview | null>(null);
  const [result, setResult] = useState<AssignmentRespondResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Once the token is verified, show the screen in the recipient's saved language.
  useRecipientLanguage(preview ? preview.preferred_language : undefined);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setResult(null);
    if (!token) {
      setStage('invalid');
      return () => {
        active = false;
      };
    }

    setStage('loading');
    void api.previewAssignmentResponse(token).then(
      (next) => {
        if (!active) return;
        setPreview(next);
        setStage('ready');
      },
      (error: unknown) => {
        if (active) setStage(assignmentResponseFailure(error));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, token]);

  const respond = async (status: 'confirmed' | 'declined'): Promise<void> => {
    if (!token || stage === 'submitting') return;
    setStage('submitting');
    try {
      const next = await api.respondToAssignmentNotification(token, { status });
      setResult(next);
      setStage('success');
    } catch (error) {
      setStage(assignmentResponseFailure(error));
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Reveal>
          <ScreenHeader eyebrow={t('respond.eyebrow')} title={t('respond.title')} />
        </Reveal>

        {stage === 'loading' ? <Loading label={t('respond.checking')} /> : null}

        {stage === 'invalid' || stage === 'expired' || stage === 'used' || stage === 'stale' || stage === 'network' ? (
          <Reveal index={1}>
            <Card>
              <IconWell name="alert" accent={theme.accent.yellow} size={44} />
              <Text style={styles.body}>{t(FAILURE_MESSAGE_KEY[stage])}</Text>
              {stage === 'network' ? (
                <Button title={t('common:actions.retry')} onPress={() => setAttempt((value) => value + 1)} />
              ) : null}
              <Button title={t('respond.openApp')} variant="secondary" onPress={() => router.replace('/')} />
            </Card>
          </Reveal>
        ) : null}

        {(stage === 'ready' || stage === 'submitting') && preview ? (
          <Reveal index={1}>
            <Card>
              <Text style={styles.heading}>{preview.person_first_name
                  ? t('respond.greeting', { name: preview.person_first_name })
                  : t('respond.greetingGeneric')}</Text>
              <View style={styles.planRow}>
                <DateBadge date={`${preview.service_date.slice(0, 10)}T12:00:00`} />
                <View style={styles.section}>
                  <Text style={styles.planTitle}>{preview.plan_title}</Text>
                  <Text style={styles.body}>
                    {fmt.calendarDate(preview.service_date)}
                    {preview.service_time
                      ? ` · ${fmt.time(preview.service_time.starts_at)}`
                      : ''}
                  </Text>
                  {preview.location ? (
                    <View style={styles.metaRow}>
                      <Icon name="mapPin" size={14} color={theme.color.inkFaint} />
                      <Text style={styles.status}>{preview.location}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.assignments}>
                {preview.assignments.map((assignment, index) => (
                  <View
                    key={`${assignment.team_name}-${assignment.position_name ?? ''}-${index}`}
                    style={styles.assignmentBox}
                  >
                    <View style={styles.assignmentTop}>
                      <Text style={styles.assignment}>
                        {assignment.team_name}
                        {assignment.position_name ? ` — ${assignment.position_name}` : ''}
                      </Text>
                      <Tag label={t(`common:assignmentStatus.${assignment.status}`)} accent={statusAccent(theme, assignment.status)} />
                    </View>
                    {assignment.times.map((time) => (
                      <View key={time.id} style={styles.metaRow}>
                        <Icon name="clock" size={14} color={theme.color.inkFaint} />
                        <Text style={styles.status}>
                          {time.name ?? t(`respond.timeKinds.${time.kind}`)} · {fmt.dateTime(time.starts_at)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
              <Text style={styles.scopeNotice}>{t('respond.scopeNotice')}</Text>
              <View style={styles.actions}>
                <Button
                  title={t('common:actions.confirm')}
                  onPress={() => void respond('confirmed')}
                  loading={stage === 'submitting'}
                />
                <Button
                  title={t('common:actions.decline')}
                  variant="secondary"
                  onPress={() => void respond('declined')}
                  disabled={stage === 'submitting'}
                />
              </View>
            </Card>
          </Reveal>
        ) : null}

        {stage === 'success' && result ? (
          <Reveal index={1}>
            <Card>
              <IconWell
                name={result.status === 'confirmed' ? 'check' : 'close'}
                accent={result.status === 'confirmed' ? theme.accent.green : theme.accent.neutral}
                size={44}
              />
              <Text style={styles.heading}>{t('respond.thankYou')}</Text>
              <Text style={styles.body}>
                {result.status === 'confirmed'
                  ? t('respond.displayedConfirmed')
                  : t('respond.displayedDeclined')}
              </Text>
              <Button title={t('respond.openApp')} onPress={() => router.replace('/')} />
            </Card>
          </Reveal>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flexGrow: 1,
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
      justifyContent: 'center',
      padding: theme.space.xl,
      gap: theme.space.xxl,
    },
    heading: { ...theme.type.title, color: theme.color.ink },
    planTitle: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    section: { gap: theme.space.xs, flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    assignments: { gap: theme.space.sm },
    assignmentBox: {
      gap: theme.space.xs,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
    },
    assignmentTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
    assignment: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    status: { ...theme.type.label, color: theme.color.inkMuted, flexShrink: 1 },
    scopeNotice: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    actions: { gap: theme.space.sm },
  });

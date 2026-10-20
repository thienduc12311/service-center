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
import { Button, Card, Label, Loading, Screen } from '../src/components/ui';
import { Reveal } from '../src/components/motion';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';
import type { Theme } from '../src/lib/theme';
import { LanguageSelector, useFormatters, useRecipientLanguage } from '../src/i18n';

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
          <View style={styles.masthead}>
            <Label>{t('respond.eyebrow')}</Label>
            <Text style={styles.title}>{t('respond.title')}</Text>
          </View>
        </Reveal>

        {stage === 'loading' ? <Loading label={t('respond.checking')} /> : null}

        {stage === 'invalid' || stage === 'expired' || stage === 'used' || stage === 'stale' || stage === 'network' ? (
          <Reveal index={1}>
            <Card>
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
              <View style={styles.section}>
                <Text style={styles.planTitle}>{preview.plan_title}</Text>
                <Text style={styles.body}>
                  {fmt.calendarDate(preview.service_date)}
                  {preview.service_time
                    ? ` · ${fmt.time(preview.service_time.starts_at)}`
                    : ''}
                  {preview.location ? ` · ${preview.location}` : ''}
                </Text>
              </View>
              <View style={styles.assignments}>
                {preview.assignments.map((assignment, index) => (
                  <View key={`${assignment.team_name}-${assignment.position_name ?? ''}-${index}`}>
                    <Text style={styles.assignment}>
                      {assignment.team_name}
                      {assignment.position_name ? ` — ${assignment.position_name}` : ''}
                    </Text>
                    <Text style={styles.status}>{t(`common:assignmentStatus.${assignment.status}`)}</Text>
                    {assignment.times.map((time) => (
                      <Text key={time.id} style={styles.status}>
                        {time.name ?? t(`respond.timeKinds.${time.kind}`)} · {fmt.dateTime(time.starts_at)}
                      </Text>
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

        <Reveal index={2}>
          <LanguageSelector />
        </Reveal>
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
    masthead: { gap: theme.space.md },
    title: { ...theme.type.display, color: theme.color.ink },
    heading: { ...theme.type.heading, color: theme.color.ink },
    planTitle: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    section: { gap: theme.space.xs },
    assignments: { gap: theme.space.md },
    assignment: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    status: { ...theme.type.label, color: theme.color.inkMuted },
    scopeNotice: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    actions: { gap: theme.space.sm },
  });

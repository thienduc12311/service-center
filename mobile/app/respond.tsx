import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ASSIGNMENT_STATUS_LABELS,
  externalLinkTokenSchema,
  formatDateTime,
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

type Stage = 'loading' | 'ready' | 'submitting' | 'success' | AssignmentResponseFailure;

const FAILURE_MESSAGE: Record<AssignmentResponseFailure, string> = {
  invalid: "This response link isn't valid. Ask the scheduler to send a new one.",
  expired: 'This response link has expired. Ask the scheduler to send a new one.',
  used: 'This response link has already been used.',
  network: "We couldn't check this response link. Check your connection and try again.",
};

/** Public, token-scoped response flow; no account or full plan access is required. */
export default function RespondScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const parsedToken = externalLinkTokenSchema.safeParse(params.token);
  const token = parsedToken.success ? parsedToken.data : null;
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [stage, setStage] = useState<Stage>(token ? 'loading' : 'invalid');
  const [preview, setPreview] = useState<AssignmentRespondPreview | null>(null);
  const [result, setResult] = useState<AssignmentRespondResult | null>(null);
  const [attempt, setAttempt] = useState(0);

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
            <Label>Assignment notification</Label>
            <Text style={styles.title}>Respond to your schedule</Text>
          </View>
        </Reveal>

        {stage === 'loading' ? <Loading label="Checking your assignment" /> : null}

        {stage === 'invalid' || stage === 'expired' || stage === 'used' || stage === 'network' ? (
          <Reveal index={1}>
            <Card>
              <Text style={styles.body}>{FAILURE_MESSAGE[stage]}</Text>
              {stage === 'network' ? (
                <Button title="Try again" onPress={() => setAttempt((value) => value + 1)} />
              ) : null}
              <Button title="Open Service Center" variant="secondary" onPress={() => router.replace('/')} />
            </Card>
          </Reveal>
        ) : null}

        {(stage === 'ready' || stage === 'submitting') && preview ? (
          <Reveal index={1}>
            <Card>
              <Text style={styles.heading}>{`Hi ${preview.person_first_name}`}</Text>
              <View style={styles.section}>
                <Text style={styles.planTitle}>{preview.plan_title}</Text>
                <Text style={styles.body}>
                  {formatDateTime(preview.service_date)}
                  {preview.service_time
                    ? ` · ${formatDateTime(preview.service_time.starts_at)}`
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
                    <Text style={styles.status}>{ASSIGNMENT_STATUS_LABELS[assignment.status]}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.scopeNotice}>
                Your answer applies to every assignment shown here for this service.
              </Text>
              <View style={styles.actions}>
                <Button
                  title="Confirm"
                  onPress={() => void respond('confirmed')}
                  loading={stage === 'submitting'}
                />
                <Button
                  title="Decline"
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
              <Text style={styles.heading}>Thank you</Text>
              <Text style={styles.body}>
                {result.status === 'confirmed'
                  ? 'Your displayed assignments are confirmed.'
                  : 'Your displayed assignments are declined.'}
              </Text>
              <Button title="Open Service Center" onPress={() => router.replace('/')} />
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

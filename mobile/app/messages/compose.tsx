import { useMemo, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PLAN_MESSAGE_GROUPS,
  defaultMessageInclude,
  keptExclusions,
  messageAudience,
  messageAudienceProblem,
  messageRecipientsToSend,
  messageSendBody,
  messageSendOutcome,
  messageVariableValues,
  messageVariablesFor,
  renderMessageTemplate,
  textHandoffBody,
  textHandoffRecipients,
  unknownMessageVariables,
  type MessageAudienceInclude,
  type MessageAudiencePreview,
  type MessageAudienceRecipient,
  type MessageSendOutcome,
  type MessageVariableSnapshot,
  type PlanDetail,
  type SendOperationalMessageResult,
  type TeamWithPositions,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { openTextComposer } from '../../src/lib/message-handoff';
import { useDiscardGuard } from '../../src/lib/useDiscardGuard';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, Card, Chip, Divider, EmptyState, ErrorNotice, Field, Label, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { PressableScale } from '../../src/components/motion';
import { Icon } from '../../src/components/icons';
import { useFormatters } from '../../src/i18n';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/**
 * MOB-018: the website's message composer (`MessageComposerModal`) on the F09
 * contracts. Choose → preview the actual permitted recipients → write →
 * explicit Send. The preview sends nothing; the send carries the reviewed
 * audience version and one idempotency key for this message, so a retry is
 * one message and a changed audience is refused for review. Texting from the
 * phone is a separate action on the same reviewed recipients.
 */
export default function ComposeMessageScreen() {
  const { planId } = useLocalSearchParams<{ planId?: string }>();
  const { t } = useTranslation(['messages', 'common']);
  const { can, canAnywhere, queryScope, generation } = useAuth();
  const isSender = canAnywhere('scheduling.manage') || canAnywhere('teams.manage');

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId),
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(planId && queryScope && isSender),
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope && isSender),
  });

  const title = t('mobileMessages.composeTitle');
  if (!isSender) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title={t('mobileMessages.noAccess')} />
      </Screen>
    );
  }
  if ((planId && !plan.data) || !teams.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        {plan.error || teams.error ? <ErrorNotice error={plan.error ?? teams.error} /> : <Loading />}
      </Screen>
    );
  }
  const planDetail = plan.data ?? null;
  // Website parity: on a plan, the teams the sender schedules there; otherwise teams they schedule or lead.
  const myTeams = teams.data.filter((team) => {
    const target = { teamId: team.id, serviceTypeId: planDetail?.service_type_id ?? team.service_type_id };
    return planDetail
      ? can('scheduling.manage', target)
      : can('scheduling.manage', target) || can('teams.manage', target);
  });
  if (!planDetail && myTeams.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title={t('mobileMessages.noTeams')} />
      </Screen>
    );
  }
  // A new identity (sign-out, organization switch) starts an empty composer.
  return <MessageComposer key={generation} plan={planDetail} teams={myTeams} />;
}

interface MessageComposerProps {
  plan: PlanDetail | null;
  teams: TeamWithPositions[];
}

function MessageComposer({ plan, teams }: MessageComposerProps) {
  const { t } = useTranslation(['messages', 'plans', 'common']);
  const format = useFormatters();
  const { user, organizationId, queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const headerHeight = useHeaderHeight();

  const [include, setInclude] = useState<MessageAudienceInclude[]>(defaultMessageInclude(Boolean(plan)));
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<MessageAudiencePreview | null>(null);
  const [selectionChanged, setSelectionChanged] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [outcome, setOutcome] = useState<MessageSendOutcome | null>(null);
  // The content of a send that got no answer: editing it afterwards is warned about.
  const [uncertainContent, setUncertainContent] = useState<string | null>(null);
  const [sent, setSent] = useState<SendOperationalMessageResult | null>(null);
  // One key for this composed message, kept across every retry and edit: if an
  // unanswered send landed, a changed resend is refused instead of sent twice.
  const sendKey = useRef(newIdempotencyKey());

  const templates = useQuery({
    queryKey: queryKeys.messageTemplates(queryScope),
    queryFn: () => api.messageTemplates(),
    enabled: Boolean(queryScope),
  });

  const audience = useMemo(() => messageAudience(plan?.id ?? null, include, teamIds), [plan, include, teamIds]);
  const problem = messageAudienceProblem(audience);
  const recipients = messageRecipientsToSend(preview, excluded);
  const unknown = unknownMessageVariables(`${subject} ${body}`);
  const content = JSON.stringify([subject, body, templateId, [...excluded].sort()]);

  const dirty = !sent && (subject.trim().length > 0 || body.trim().length > 0);
  const guard = useDiscardGuard({
    dirty,
    message: t('mobileMessages.discardConfirm'),
    keepLabel: t('plans:mobileOrder.keepEditing'),
    discardLabel: t('plans:mobileOrder.discard'),
  });

  const membership = user?.memberships.find((entry) => entry.organization.id === organizationId);
  const snapshot: MessageVariableSnapshot = {
    organization_name: membership?.organization.name ?? null,
    organization_timezone: membership?.organization.timezone ?? null,
    plan_title: plan?.title ?? null,
    plan_date: plan?.service_date ?? null,
    sender_name: user?.profile.full_name ?? null,
  };
  const sample = recipients[0];
  const sampleValues = sample ? messageVariableValues(sample, snapshot) : null;

  const runPreview = useMutation({
    mutationFn: () => api.previewMessage({ audience }),
    onSuccess: (result) => {
      if (!isCurrentGeneration(generation)) return;
      setPreview(result);
      setSelectionChanged(false);
      setExcluded((current) => keptExclusions(result, current));
    },
  });

  const send = useMutation({
    mutationFn: () => api.sendMessage(messageSendBody({
      audience,
      subject,
      body,
      templateId,
      excluded,
      preview: preview!,
      idempotencyKey: sendKey.current,
    })),
    onSuccess: async (result) => {
      if (!isCurrentGeneration(generation)) return;
      setSent(result);
      setOutcome(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.messagesAll(queryScope) });
    },
    onError: (error) => {
      if (!isCurrentGeneration(generation)) return;
      const next = messageSendOutcome(error);
      setOutcome(next);
      if (next === 'uncertain') setUncertainContent(content);
      if (next === 'audienceChanged') {
        // Nothing was sent: show the current recipients for review.
        setStaleNotice(true);
        setPreview(null);
        runPreview.mutate();
      }
    },
  });

  const saveTemplate = useMutation({
    mutationFn: (shared: boolean) => api.createMessageTemplate({ name: templateName.trim(), subject, body, shared }),
    onSuccess: async (template) => {
      if (!isCurrentGeneration(generation)) return;
      setTemplateId(template.id);
      setTemplateName('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.messageTemplates(queryScope) });
    },
  });

  const changeAudience = (update: () => void) => {
    update();
    if (preview) setSelectionChanged(true);
    setPreview(null);
    setStaleNotice(false);
  };
  const toggle = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const applyTemplate = (id: string | null) => {
    const template = templates.data?.templates.find((candidate) => candidate.id === id);
    setTemplateId(template?.id ?? null);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  if (sent) {
    const { message } = sent;
    return (
      <Screen>
        <Stack.Screen options={{ title: t('messageComposer.sentTitle') }} />
        <ScrollView contentContainerStyle={screenPadding(theme)}>
          <Card>
            <Label>{t('messageComposer.sentTitle')}</Label>
            {sent.replayed ? <Text style={styles.body}>{t('messageComposer.replayed')}</Text> : null}
            <Text accessibilityRole="alert" style={styles.body}>
              {message.excluded_count
                ? t('messageComposer.queuedWithExcluded', { count: message.recipient_count, excluded: message.excluded_count })
                : t('messageComposer.queued', { count: message.recipient_count })}
            </Text>
            <Text style={styles.muted}>{t('messageComposer.outcomesNote')}</Text>
            <View style={styles.wrap}>
              <Button
                title={t('messageComposer.viewOutcomes')}
                onPress={() => router.replace({ pathname: '/messages/[id]', params: { id: message.id } })}
              />
              <Button title={t('common:actions.done')} variant="secondary" onPress={guard.leave} />
            </View>
          </Card>
          {preview ? <TextHandoff preview={preview} body={body} snapshot={snapshot} /> : null}
        </ScrollView>
      </Screen>
    );
  }

  const canSend = Boolean(preview) && recipients.length > 0 && subject.trim().length > 0
    && body.trim().length > 0 && unknown.length === 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: plan ? t('messageComposer.planTitle', { plan: plan.title }) : t('messageComposer.teamTitle') }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView contentContainerStyle={screenPadding(theme)} keyboardShouldPersistTaps="handled">
          <Card>
            <Label>{t('messageComposer.who')}</Label>
            {(plan ? PLAN_MESSAGE_GROUPS : (['team_members'] as const)).map((group) => (
              <CheckRow
                key={group}
                label={t(`audienceInclude.${group}`)}
                checked={include.includes(group)}
                onPress={() => changeAudience(() => setInclude((current) => toggle(current, group)))}
              />
            ))}
            <Text style={styles.muted}>{plan ? t('messageComposer.limitTeamsHint') : t('messageComposer.teamsLabel')}</Text>
            <View style={styles.wrap}>
              {teams.map((team) => (
                <Chip
                  key={team.id}
                  label={team.name}
                  active={teamIds.includes(team.id)}
                  onPress={() => changeAudience(() => setTeamIds((current) => toggle(current, team.id)))}
                />
              ))}
            </View>
            {problem ? <Text style={styles.muted}>{t(`mobileMessages.problems.${problem}`)}</Text> : null}
            <Button
              title={preview ? t('messageComposer.refreshRecipients') : t('messageComposer.previewRecipients')}
              variant="secondary"
              disabled={problem !== null}
              loading={runPreview.isPending}
              onPress={() => runPreview.mutate()}
            />
            <ErrorNotice error={runPreview.error} />
          </Card>

          {staleNotice ? (
            <Text accessibilityRole="alert" style={styles.warning}>{t('messageComposer.staleNotice')}</Text>
          ) : selectionChanged ? (
            <Text accessibilityRole="alert" style={styles.warning}>{t('mobileMessages.selectionChanged')}</Text>
          ) : null}

          {preview ? (
            <Card>
              <Label>
                {preview.recipients.length - recipients.length > 0
                  ? t('messageComposer.willReceiveWithExcluded', { count: recipients.length, excluded: preview.recipients.length - recipients.length })
                  : t('messageComposer.willReceive', { count: recipients.length })}
              </Label>
              {preview.recipients.length === 0 ? (
                <Text style={styles.muted}>{t('messageComposer.nobodyMatches')}</Text>
              ) : (
                preview.recipients.map((recipient, index) => (
                  <View key={recipient.person_id}>
                    {index > 0 ? <Divider /> : null}
                    <RecipientRow
                      recipient={recipient}
                      included={recipient.reachable && !excluded.includes(recipient.person_id)}
                      onToggle={() => setExcluded((current) => toggle(current, recipient.person_id))}
                    />
                  </View>
                ))
              )}
            </Card>
          ) : null}

          <Card>
            <Label>{t('messageComposer.messageHeading')}</Label>
            {(templates.data?.templates.length ?? 0) > 0 ? (
              <>
                <Text style={styles.muted}>{t('messageComposer.templateLabel')}</Text>
                <View accessibilityRole="radiogroup" style={styles.wrap}>
                  <Chip label={t('messageComposer.noTemplate')} active={templateId === null} onPress={() => applyTemplate(null)} />
                  {(templates.data?.templates ?? []).map((template) => (
                    <Chip
                      key={template.id}
                      label={template.owner_id ? template.name : t('messageComposer.sharedTemplate', { name: template.name })}
                      active={templateId === template.id}
                      onPress={() => applyTemplate(template.id)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <Field
              accessibilityLabel={t('messageComposer.subjectPlaceholder')}
              placeholder={t('messageComposer.subjectPlaceholder')}
              maxLength={200}
              value={subject}
              onChangeText={setSubject}
            />
            <Field
              accessibilityLabel={t('messageComposer.bodyPlaceholder')}
              placeholder={t('messageComposer.bodyPlaceholder')}
              maxLength={8000}
              multiline
              textAlignVertical="top"
              style={styles.bodyInput}
              value={body}
              onChangeText={setBody}
            />
            <View style={styles.wrap}>
              {messageVariablesFor(Boolean(plan)).map((variable) => (
                <PressableScale
                  key={variable}
                  accessibilityRole="button"
                  accessibilityLabel={t('mobileMessages.insertVariable', { variable: t(`messageComposer.variables.${variable}`) })}
                  onPress={() => setBody((current) => `${current}{{${variable}}}`)}
                  style={styles.variable}
                >
                  <Text style={styles.variableText}>{`{{${variable}}}`}</Text>
                </PressableScale>
              ))}
            </View>
            {unknown.length > 0 ? (
              <Text accessibilityRole="alert" style={styles.danger}>
                {t('messageComposer.unknownVariables', { count: unknown.length, names: format.list(unknown) })}
              </Text>
            ) : null}
            {sampleValues && subject && body ? (
              <View style={styles.sample}>
                <Text style={styles.muted}>{t('messageComposer.previewFor', { name: sample?.first_name ?? '' })}</Text>
                <Text style={[styles.body, styles.strong]}>{renderMessageTemplate(subject, sampleValues)}</Text>
                <Text style={styles.body}>{renderMessageTemplate(body, sampleValues)}</Text>
              </View>
            ) : null}
            <Text style={styles.muted}>{t('messageComposer.repliesNote')}</Text>
            <Field
              label={t('mobileMessages.templateName')}
              maxLength={80}
              value={templateName}
              onChangeText={setTemplateName}
            />
            <View style={styles.wrap}>
              <Button
                title={t('messageComposer.saveMine')}
                variant="quiet"
                disabled={!templateName.trim() || !subject.trim() || !body.trim() || unknown.length > 0}
                loading={saveTemplate.isPending && saveTemplate.variables === false}
                onPress={() => saveTemplate.mutate(false)}
              />
              {templates.data?.can_manage_shared ? (
                <Button
                  title={t('messageComposer.saveShared')}
                  variant="quiet"
                  disabled={!templateName.trim() || !subject.trim() || !body.trim() || unknown.length > 0}
                  loading={saveTemplate.isPending && saveTemplate.variables === true}
                  onPress={() => saveTemplate.mutate(true)}
                />
              ) : null}
            </View>
            {saveTemplate.isSuccess && !templateName ? <Text style={styles.success}>{t('mobileMessages.templateSaved')}</Text> : null}
            <ErrorNotice error={saveTemplate.error} />
          </Card>

          {outcome === 'uncertain' ? (
            <View accessibilityRole="alert" style={styles.warningBox}>
              <Text style={styles.warningText}>{t('messageComposer.uncertain')}</Text>
              {uncertainContent !== null && uncertainContent !== content ? (
                <Text style={styles.warningText}>{t('messageComposer.editedAfterUncertain')}</Text>
              ) : null}
            </View>
          ) : outcome === 'keyReused' ? (
            <View accessibilityRole="alert" style={styles.warningBox}>
              <Text style={styles.warningText}>{t('messageComposer.keyReused')}</Text>
              <Button title={t('messageComposer.viewSent')} variant="secondary" onPress={() => router.replace('/messages')} />
            </View>
          ) : outcome === 'refused' ? (
            <ErrorNotice error={send.error} />
          ) : null}
          {!preview && !problem ? <Text style={styles.muted}>{t('mobileMessages.previewFirst')}</Text> : null}
          <Button
            title={outcome === 'uncertain' ? t('messageComposer.tryAgain') : t('messageComposer.sendTo', { count: recipients.length })}
            accessibilityLabel={t('messageComposer.sendTo', { count: recipients.length })}
            icon="chat"
            disabled={!canSend || outcome === 'keyReused'}
            loading={send.isPending}
            onPress={() => send.mutate()}
          />

          {preview ? <TextHandoff preview={preview} body={body} snapshot={snapshot} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

interface CheckRowProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
  children?: ReactNode;
}

/** A 44 pt checkbox row (PressableScale, not a function-form Pressable style: MOB-001). */
function CheckRow({ label, checked, disabled = false, onPress, children }: CheckRowProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.checkRow, disabled && styles.disabled]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Icon name="check" size={14} color={theme.color.onBrand} /> : null}
      </View>
      <View style={styles.flex}>
        {children ?? <Text style={styles.body}>{label}</Text>}
      </View>
    </PressableScale>
  );
}

interface RecipientRowProps {
  recipient: MessageAudienceRecipient;
  included: boolean;
  onToggle: () => void;
}

function RecipientRow({ recipient, included, onToggle }: RecipientRowProps) {
  const { t } = useTranslation('messages');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const name = [recipient.first_name, recipient.last_name].filter(Boolean).join(' ');
  return (
    <CheckRow
      label={t('messageComposer.includeName', { name })}
      checked={included}
      disabled={!recipient.reachable}
      onPress={onToggle}
    >
      <Text style={styles.body}>{name}</Text>
      <View style={styles.tags}>
        {recipient.reasons.map((reason) => (
          <Tag key={reason} label={t(`audienceReasons.${reason}`)} accent={theme.accent.neutral} />
        ))}
      </View>
      {!recipient.reachable ? (
        <Text style={styles.danger}>{t('messageComposer.unreachable')}</Text>
      ) : !recipient.has_email ? (
        <Text style={styles.muted}>{t('messageComposer.appOnly')}</Text>
      ) : !recipient.has_login ? (
        <Text style={styles.muted}>{t('messageComposer.emailOnly')}</Text>
      ) : null}
    </CheckRow>
  );
}

interface TextHandoffProps {
  preview: MessageAudiencePreview;
  body: string;
  snapshot: MessageVariableSnapshot;
}

/**
 * Texting from the person's own phone: only previewed recipients, only phone
 * numbers the People list discloses to this caller, nobody selected until the
 * sender chooses. Opening the composer records nothing and proves nothing.
 */
function TextHandoff({ preview, body, snapshot }: TextHandoffProps) {
  const { t } = useTranslation('messages');
  const format = useFormatters();
  const { queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<'opened' | 'failed' | null>(null);

  const people = useQuery({
    queryKey: queryKeys.people(queryScope),
    queryFn: () => api.listPeople(),
    enabled: Boolean(queryScope),
  });

  const candidates = useMemo(
    () => textHandoffRecipients(preview.recipients, people.data ?? []),
    [preview, people.data],
  );
  const withPhone = candidates.filter((candidate) => candidate.phone);
  const chosen = withPhone.filter((candidate) => selected.includes(candidate.person_id));
  const chosenRecipients = preview.recipients.filter((recipient) => chosen.some((c) => c.person_id === recipient.person_id));
  const handoff = textHandoffBody(body, snapshot, chosenRecipients);

  const open = async () => {
    if (!handoff.ok) return;
    const ok = await openTextComposer(chosen.flatMap((candidate) => (candidate.phone ? [candidate.phone] : [])), handoff.text);
    setOpened(ok ? 'opened' : 'failed');
  };

  return (
    <Card>
      <Label>{t('mobileMessages.textHeading')}</Label>
      <Text style={styles.muted}>{t('mobileMessages.textIntro')}</Text>
      {people.isLoading ? <Loading /> : null}
      <ErrorNotice error={people.error} />
      {people.data && withPhone.length === 0 ? <Text style={styles.body}>{t('mobileMessages.textNoPhones')}</Text> : null}
      {withPhone.map((candidate, index) => (
        <View key={candidate.person_id}>
          {index > 0 ? <Divider /> : null}
          <CheckRow
            label={t('mobileMessages.textSelect', { name: candidate.name })}
            checked={selected.includes(candidate.person_id)}
            onPress={() => {
              setOpened(null);
              setSelected((current) => current.includes(candidate.person_id)
                ? current.filter((id) => id !== candidate.person_id)
                : [...current, candidate.person_id]);
            }}
          >
            <Text style={styles.body}>{candidate.name}</Text>
            <Text style={styles.muted}>{candidate.phone}</Text>
          </CheckRow>
        </View>
      ))}
      {people.data && withPhone.length > 0 && candidates.length > withPhone.length ? (
        <Text style={styles.muted}>{t('mobileMessages.textHidden', { count: candidates.length - withPhone.length })}</Text>
      ) : null}
      {withPhone.length > 0 ? (
        <>
          {!body.trim() ? (
            <Text style={styles.muted}>{t('mobileMessages.textEmpty')}</Text>
          ) : chosen.length === 0 ? (
            <Text style={styles.muted}>{t('mobileMessages.textSelectNone')}</Text>
          ) : !handoff.ok ? (
            <Text accessibilityRole="alert" style={styles.danger}>
              {t('mobileMessages.textPersonalVariables', {
                count: handoff.personalVariables.length,
                names: format.list(handoff.personalVariables.map((variable) => `{{${variable}}}`)),
              })}
            </Text>
          ) : (
            <View style={styles.sample}>
              <Text style={styles.muted}>{t('mobileMessages.textPreview')}</Text>
              <Text style={styles.body}>{handoff.text}</Text>
            </View>
          )}
          <Button
            title={t('mobileMessages.textOpen', { count: chosen.length })}
            variant="secondary"
            disabled={!body.trim() || chosen.length === 0 || !handoff.ok}
            onPress={() => void open()}
          />
          {opened === 'opened' ? <Text style={styles.muted}>{t('mobileMessages.textOpened')}</Text> : null}
          {opened === 'failed' ? <Text accessibilityRole="alert" style={styles.danger}>{t('mobileMessages.textOpenFailed')}</Text> : null}
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, marginTop: theme.space.xs },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    danger: { ...theme.type.bodySmall, color: theme.color.danger },
    success: {
      ...theme.type.bodySmall,
      color: theme.accent.green.fg,
      backgroundColor: theme.accent.green.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    warningBox: {
      gap: theme.space.sm,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    warningText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    bodyInput: { minHeight: 140 },
    sample: {
      gap: theme.space.xs,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.surfaceInset,
    },
    variable: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: theme.space.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.surfaceInset,
    },
    variableText: { ...theme.type.bodySmall, color: theme.color.inkMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md, minHeight: 44, paddingVertical: theme.space.sm },
    disabled: { opacity: 0.6 },
    box: {
      width: 22,
      height: 22,
      marginTop: 1,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  });

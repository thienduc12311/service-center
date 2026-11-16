import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHURCH_JOIN_TEXT_MAX,
  churchJoinView,
  churchSlugFromInput,
  isChurchSlug,
  type ChurchLookup,
  type CreateChurchJoinRequestRequest,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { useMyChurchJoinRequests } from '../../lib/useChurchJoinRequests';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Button, Card, ErrorNotice, Field, IconWell, Loading } from '../ui';
import type { Accent, Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import type { IconName } from '../icons';

/**
 * The requester's side of joining an existing church by its slug, as on the
 * web welcome page: find the church, confirm it and send a request; then the
 * pending request (withdraw it), a decline with its reason, or an approval
 * (the invitation is on its way by email). Accepting that invitation adds the
 * church; pull to refresh on the welcome screen picks it up.
 */
export const ChurchJoinFlow = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { date } = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const { user, generation, isCurrentGeneration } = useAuth();
  const userId = user?.profile.id;
  const requests = useMyChurchJoinRequests();
  // "Try another church" after a decision shows the form over it.
  const [askingAnother, setAskingAnother] = useState(false);

  const refreshRequests = async (): Promise<void> => {
    if (!isCurrentGeneration(generation)) return;
    setAskingAnother(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.churchJoinRequests(userId) });
  };

  const withdraw = useMutation({
    mutationFn: (id: string) => api.withdrawChurchJoinRequest(id),
    onSuccess: refreshRequests,
  });

  if (requests.isLoading) return <Loading />;
  if (requests.error) {
    return (
      <Card>
        <ErrorNotice error={requests.error} />
        <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void requests.refetch()} />
      </Card>
    );
  }

  const list = requests.data ?? [];
  const view = churchJoinView(list);

  if (view.kind === 'pending') {
    const { request } = view;
    const confirmWithdraw = (): void => {
      Alert.alert(
        t('churchJoin.pending.withdraw'),
        t('churchJoin.pending.withdrawConfirm', { church: request.organization_name }),
        [
          { text: t('common:actions.cancel'), style: 'cancel' },
          {
            text: t('churchJoin.pending.withdraw'),
            style: 'destructive',
            onPress: () => withdraw.mutate(request.id),
          },
        ],
      );
    };
    return (
      <StatusCard
        icon="clock"
        accent={theme.accent.yellow}
        title={t('churchJoin.pending.title')}
        body={t('churchJoin.pending.body', {
          church: request.organization_name,
          date: date(request.created_at, 'medium'),
        })}
      >
        <ErrorNotice error={withdraw.error} />
        <Button
          title={t('churchJoin.pending.withdraw')}
          variant="secondary"
          loading={withdraw.isPending}
          onPress={confirmWithdraw}
        />
      </StatusCard>
    );
  }

  if (view.kind === 'declined' && !askingAnother) {
    const { request } = view;
    return (
      <StatusCard
        icon="alert"
        accent={theme.accent.red}
        title={t('churchJoin.declined.title')}
        body={t('churchJoin.declined.body', { church: request.organization_name })}
        detail={request.decline_reason ? t('churchJoin.declined.reason', { reason: request.decline_reason }) : undefined}
      >
        <Button title={t('churchJoin.declined.tryAnother')} icon="repeat" onPress={() => setAskingAnother(true)} />
      </StatusCard>
    );
  }

  if (view.kind === 'approved' && !askingAnother) {
    const { request } = view;
    return (
      <StatusCard
        icon="mail"
        accent={theme.accent.green}
        title={t('churchJoin.approved.title')}
        body={t('churchJoin.approved.body', { church: request.organization_name })}
      >
        <Button title={t('churchJoin.approved.tryAnother')} variant="secondary" onPress={() => setAskingAnother(true)} />
      </StatusCard>
    );
  }

  return (
    <View style={styles.stack}>
      {view.kind === 'form' && list[0]?.status === 'withdrawn' ? (
        <Text style={styles.muted}>{t('churchJoin.withdrawn')}</Text>
      ) : null}
      <JoinChurchForm
        onSent={refreshRequests}
        onCancel={askingAnother ? () => setAskingAnother(false) : undefined}
      />
    </View>
  );
};

interface StatusCardProps {
  icon: IconName;
  accent: Accent;
  title: string;
  body: string;
  /** A second paragraph, such as the decline reason. */
  detail?: string;
  children?: ReactNode;
}

const StatusCard = ({ icon, accent, title, body, detail, children }: StatusCardProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <Card>
      <View style={styles.statusHeader}>
        <IconWell name={icon} accent={accent} size={40} />
        <Text accessibilityRole="header" style={styles.statusTitle}>{title}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      {detail ? <Text style={styles.body}>{detail}</Text> : null}
      {children}
    </Card>
  );
};

interface JoinChurchFormProps {
  /** The request was created. */
  onSent: () => Promise<void>;
  /** Back to the decision shown before "Try another church". */
  onCancel?: () => void;
}

/** Slug → church name to confirm → optional message → request. */
const JoinChurchForm = ({ onSent, onCancel }: JoinChurchFormProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const styles = useThemedStyles(makeStyles);
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [church, setChurch] = useState<ChurchLookup | null>(null);
  const [message, setMessage] = useState('');

  const find = useMutation({ mutationFn: (slug: string) => api.findChurchBySlug(slug), onSuccess: setChurch });
  const send = useMutation({
    mutationFn: (body: CreateChurchJoinRequestRequest) => api.requestToJoinChurch(body),
    onSuccess: onSent,
  });

  const submitFind = (): void => {
    const slug = churchSlugFromInput(input);
    if (!isChurchSlug(slug)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    find.mutate(slug);
  };

  if (church) {
    return (
      <Card>
        <View style={styles.found}>
          <Text style={styles.foundLabel}>{t('churchJoin.confirmTitle')}</Text>
          <Text accessibilityRole="header" style={styles.foundName}>{church.name}</Text>
          <Text style={styles.foundSlug}>{church.slug}</Text>
        </View>
        <Field
          label={t('common:format.fieldOptional', { label: t('churchJoin.messageLabel') })}
          value={message}
          onChangeText={setMessage}
          placeholder={t('churchJoin.messagePlaceholder')}
          maxLength={CHURCH_JOIN_TEXT_MAX}
          multiline
          autoCapitalize="sentences"
          editable={!send.isPending}
        />
        <ErrorNotice error={send.error} />
        <Button
          title={t('churchJoin.send')}
          icon="mail"
          loading={send.isPending}
          onPress={() => send.mutate({ slug: church.slug, message: message.trim() || null })}
        />
        <Button
          title={t('churchJoin.notThisOne')}
          variant="quiet"
          disabled={send.isPending}
          onPress={() => {
            setChurch(null);
            send.reset();
          }}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.body}>{t('churchJoin.intro')}</Text>
      <Field
        label={t('churchJoin.slugLabel')}
        value={input}
        onChangeText={(value) => {
          setInput(value);
          setInvalid(false);
          find.reset();
        }}
        placeholder={t('churchJoin.slugPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="search"
        onSubmitEditing={submitFind}
        editable={!find.isPending}
      />
      <Text style={invalid ? styles.hintError : styles.muted}>
        {invalid ? t('churchJoin.slugInvalid') : t('churchJoin.slugHint')}
      </Text>
      <ErrorNotice error={find.error} />
      <Button
        title={t('churchJoin.find')}
        icon="search"
        loading={find.isPending}
        disabled={!input.trim()}
        onPress={submitFind}
      />
      {onCancel ? <Button title={t('common:actions.cancel')} variant="quiet" onPress={onCancel} /> : null}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    stack: { gap: theme.space.md },
    statusHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    statusTitle: { ...theme.type.title, color: theme.color.ink, flex: 1 },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hintError: { ...theme.type.bodySmall, color: theme.color.danger },
    found: {
      gap: 2,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
    },
    foundLabel: { ...theme.type.eyebrow, color: theme.color.inkMuted },
    foundName: { ...theme.type.title, color: theme.color.ink },
    foundSlug: { ...theme.type.code, color: theme.color.inkFaint },
  });

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View, type KeyboardTypeOptions } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  churchApplicationDraftFrom,
  churchApplicationRequestFrom,
  churchApplicationView,
  emptyChurchApplicationDraft,
  type ChurchApplication,
  type ChurchApplicationDraft,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { deviceTimeZone, isChurchApplicationDraftComplete } from '../../lib/church-platform';
import { useMyChurchApplications } from '../../lib/useChurchApplications';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Button, Card, ErrorNotice, Field, IconWell, Loading } from '../ui';
import type { Accent, Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import type { IconName } from '../icons';

/** The label keys under `settings:churchApplication.fields`. */
type ChurchApplicationFieldLabel =
  | 'churchName'
  | 'leaderName'
  | 'contactPhone'
  | 'website'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'stateProvince'
  | 'postalCode'
  | 'country'
  | 'expectedMemberCount'
  | 'timezone'
  | 'note';

interface ChurchApplicationFieldSpec {
  field: keyof ChurchApplicationDraft;
  label: ChurchApplicationFieldLabel;
  required?: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  /** Free text that should not be capitalized (addresses on the web, zone names). */
  plain?: boolean;
}

const FIELDS: readonly ChurchApplicationFieldSpec[] = [
  { field: 'church_name', label: 'churchName', required: true },
  { field: 'leader_name', label: 'leaderName', required: true },
  { field: 'contact_phone', label: 'contactPhone', keyboardType: 'phone-pad' },
  { field: 'website', label: 'website', keyboardType: 'url', plain: true },
  { field: 'address_line1', label: 'addressLine1' },
  { field: 'address_line2', label: 'addressLine2' },
  { field: 'city', label: 'city', required: true },
  { field: 'state_province', label: 'stateProvince' },
  { field: 'postal_code', label: 'postalCode' },
  { field: 'country', label: 'country', required: true },
  { field: 'expected_member_count', label: 'expectedMemberCount', keyboardType: 'number-pad' },
  { field: 'timezone', label: 'timezone', required: true, plain: true },
  { field: 'note', label: 'note', multiline: true },
];

/** Which form is open over the current state, if any. */
type FormMode =
  | { kind: 'closed' }
  /** A new application, prefilled from a rejected one when trying again. */
  | { kind: 'new'; prefill: ChurchApplication }
  /** Editing the pending application. */
  | { kind: 'edit'; application: ChurchApplication };

/** A pending application's id with the edited values. */
interface ChurchApplicationUpdate {
  id: string;
  draft: ChurchApplicationDraft;
}

export interface ChurchApplicationFlowProps {
  /** True when the person already belongs to a church (Profile's "Register another church"). */
  hasChurch: boolean;
}

/**
 * The applicant's side of a church application: the form, a pending request
 * (edit or withdraw), a rejection with its reason, or an approval that opens
 * the new church. See docs/plans/super-admin-dashboard.md.
 */
export const ChurchApplicationFlow = ({ hasChurch }: ChurchApplicationFlowProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { date } = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const { user, generation, isCurrentGeneration, refreshUser } = useAuth();
  const userId = user?.profile.id;
  const applications = useMyChurchApplications();
  const [mode, setMode] = useState<FormMode>({ kind: 'closed' });

  const refreshApplications = async (): Promise<void> => {
    if (!isCurrentGeneration(generation)) return;
    setMode({ kind: 'closed' });
    await queryClient.invalidateQueries({ queryKey: queryKeys.churchApplications(userId) });
  };

  const submit = useMutation({
    mutationFn: (draft: ChurchApplicationDraft) => api.submitChurchApplication(churchApplicationRequestFrom(draft)),
    onSuccess: refreshApplications,
  });

  const update = useMutation({
    mutationFn: ({ id, draft }: ChurchApplicationUpdate) =>
      api.updateChurchApplication(id, churchApplicationRequestFrom(draft)),
    onSuccess: refreshApplications,
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api.withdrawChurchApplication(id),
    onSuccess: refreshApplications,
  });

  const openChurch = useMutation({ mutationFn: () => refreshUser() });

  if (applications.isLoading) return <Loading />;
  if (applications.error) {
    return (
      <Card>
        <ErrorNotice error={applications.error} />
        <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void applications.refetch()} />
      </Card>
    );
  }

  const list = applications.data ?? [];
  const view = churchApplicationView(list, { hasChurch });

  if (mode.kind === 'edit') {
    return (
      <ChurchApplicationForm
        key={`edit-${mode.application.id}`}
        initial={churchApplicationDraftFrom(mode.application)}
        submitLabel={t('churchApplication.saveChanges')}
        pending={update.isPending}
        error={update.error}
        onSubmit={(draft) => update.mutate({ id: mode.application.id, draft })}
        onCancel={() => setMode({ kind: 'closed' })}
      />
    );
  }

  if (mode.kind === 'new' || view.kind === 'form') {
    const prefill = mode.kind === 'new' ? mode.prefill : null;
    const withdrawn = view.kind === 'form' && list[0]?.status === 'withdrawn';
    return (
      <View style={styles.stack}>
        {withdrawn ? <Text style={styles.muted}>{t('churchApplication.withdrawn')}</Text> : null}
        <ChurchApplicationForm
          key={prefill ? `retry-${prefill.id}` : 'new'}
          initial={prefill ? churchApplicationDraftFrom(prefill) : emptyChurchApplicationDraft(deviceTimeZone())}
          submitLabel={t('churchApplication.submit')}
          pending={submit.isPending}
          error={submit.error}
          onSubmit={(draft) => submit.mutate(draft)}
          onCancel={prefill ? () => setMode({ kind: 'closed' }) : undefined}
        />
      </View>
    );
  }

  const { application } = view;

  if (view.kind === 'pending') {
    const confirmWithdraw = (): void => {
      Alert.alert(
        t('churchApplication.pending.withdraw'),
        t('churchApplication.pending.withdrawConfirm', { church: application.church_name }),
        [
          { text: t('common:actions.cancel'), style: 'cancel' },
          {
            text: t('churchApplication.pending.withdraw'),
            style: 'destructive',
            onPress: () => withdraw.mutate(application.id),
          },
        ],
      );
    };
    return (
      <StatusCard
        icon="clock"
        accent={theme.accent.yellow}
        title={t('churchApplication.pending.title')}
        body={t('churchApplication.pending.body', {
          church: application.church_name,
          date: date(application.created_at, 'medium'),
        })}
      >
        <ErrorNotice error={withdraw.error} />
        <Button
          title={t('churchApplication.pending.edit')}
          icon="pencil"
          variant="secondary"
          disabled={withdraw.isPending}
          onPress={() => setMode({ kind: 'edit', application })}
        />
        <Button
          title={t('churchApplication.pending.withdraw')}
          variant="quiet"
          loading={withdraw.isPending}
          onPress={confirmWithdraw}
        />
      </StatusCard>
    );
  }

  if (view.kind === 'rejected') {
    return (
      <StatusCard
        icon="alert"
        accent={theme.accent.red}
        title={t('churchApplication.rejected.title')}
        body={t('churchApplication.rejected.body', { church: application.church_name })}
        detail={
          application.rejection_reason
            ? t('churchApplication.rejected.reason', { reason: application.rejection_reason })
            : undefined
        }
      >
        <Button
          title={t('churchApplication.rejected.applyAgain')}
          icon="repeat"
          onPress={() => setMode({ kind: 'new', prefill: application })}
        />
      </StatusCard>
    );
  }

  return (
    <StatusCard
      icon="check"
      accent={theme.accent.green}
      title={t('churchApplication.approved.title')}
      body={t('churchApplication.approved.body', { church: application.church_name })}
    >
      <ErrorNotice error={openChurch.error} />
      <Button
        title={t('churchApplication.approved.open', { church: application.church_name })}
        loading={openChurch.isPending}
        onPress={() => openChurch.mutate()}
      />
    </StatusCard>
  );
};

interface StatusCardProps {
  icon: IconName;
  accent: Accent;
  title: string;
  body: string;
  /** A second paragraph, such as the rejection reason. */
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

interface ChurchApplicationFormProps {
  initial: ChurchApplicationDraft;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (draft: ChurchApplicationDraft) => void;
  onCancel?: () => void;
}

const ChurchApplicationForm = ({ initial, submitLabel, pending, error, onSubmit, onCancel }: ChurchApplicationFormProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const [draft, setDraft] = useState<ChurchApplicationDraft>(initial);
  const complete = isChurchApplicationDraftComplete(draft);

  return (
    <Card>
      {FIELDS.map((spec) => {
        const label = t(`churchApplication.fields.${spec.label}`);
        return (
          <Field
            key={spec.field}
            label={spec.required ? label : t('common:format.fieldOptional', { label })}
            value={draft[spec.field]}
            onChangeText={(value) => setDraft((current) => ({ ...current, [spec.field]: value }))}
            placeholder={spec.field === 'church_name' ? t('churchApplication.fields.churchNamePlaceholder') : undefined}
            keyboardType={spec.keyboardType}
            multiline={spec.multiline}
            autoCapitalize={spec.plain ? 'none' : spec.multiline ? 'sentences' : 'words'}
            autoCorrect={!spec.plain}
            editable={!pending}
          />
        );
      })}
      <ErrorNotice error={error} />
      <Button title={submitLabel} loading={pending} disabled={!complete} onPress={() => onSubmit(draft)} />
      {onCancel ? (
        <Button title={t('common:actions.cancel')} variant="quiet" disabled={pending} onPress={onCancel} />
      ) : null}
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
  });

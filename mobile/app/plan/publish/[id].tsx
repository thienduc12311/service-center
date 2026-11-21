import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { useAuth } from '../../../src/providers/AuthProvider';
import { Button, Card, EmptyState, ErrorNotice, Loading, Screen, screenPadding } from '../../../src/components/ui';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';
import { useFormatters } from '../../../src/i18n';
import { newIdempotencyKey } from '../../../src/lib/idempotency';

/**
 * ADR-0006: the website's publish confirmation. Publishing asks everyone
 * released and never notified, so say who will be emailed and who has no
 * address first, with "Notify people" on by default.
 */
export default function PublishPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['plans', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, queryScope } = useAuth();
  const [notify, setNotify] = useState(true);
  // One key per confirmation: a retried request never asks twice.
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });
  const preview = useQuery({
    queryKey: queryKeys.planPublishPreview(queryScope, id),
    queryFn: () => api.planPublishPreview(id!),
    enabled: Boolean(id && queryScope),
    staleTime: 0,
  });
  const publish = useMutation({
    mutationFn: () => api.updatePlan(id!, { status: 'published', notify, idempotency_key: idempotencyKey }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.schedule(queryScope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.planDeliveries(queryScope, id) }),
      ]);
      router.back();
    },
  });

  if (plan.isPending || preview.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('publishConfirm.title') }} />
        <Loading label={t('publishConfirm.loading')} />
      </Screen>
    );
  }
  if (!plan.data || !can('plans.edit', { serviceTypeId: plan.data.service_type_id })) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('publishConfirm.title') }} />
        {plan.error ? <ErrorNotice error={plan.error} /> : <EmptyState icon="alert" title={t('planDetail.notFound')} />}
      </Screen>
    );
  }

  const willNotify = preview.data?.will_notify ?? 0;
  const noEmail = preview.data?.no_email ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('publishConfirm.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.gap]}>
        <Card>
          <Text style={styles.title}>{plan.data.title}</Text>
          <Text style={styles.body}>
            {willNotify > 0 || noEmail.length > 0
              ? t('publishConfirm.willEmail', { count: willNotify })
              : t('publishConfirm.nobody')}
          </Text>
          {noEmail.length > 0 ? (
            <Text accessibilityRole="alert" style={styles.warn}>
              {t('publishConfirm.noEmail', { count: noEmail.length, names: format.list(noEmail) })}
            </Text>
          ) : null}
        </Card>
        <Card>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={styles.body}>{t('publishConfirm.notify')}</Text>
              <Text style={styles.muted}>{t('publishConfirm.notifyHint')}</Text>
            </View>
            <Switch accessibilityLabel={t('publishConfirm.notify')} value={notify} onValueChange={setNotify} />
          </View>
        </Card>
        <ErrorNotice error={preview.error ?? publish.error} />
        <Button title={t('publishConfirm.confirm')} icon="check" loading={publish.isPending} onPress={() => publish.mutate()} />
        <Button title={t('common:actions.cancel')} variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    gap: { gap: theme.space.lg },
    title: { ...theme.type.body, fontWeight: '600', color: theme.color.ink, marginBottom: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warn: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, marginTop: theme.space.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  });

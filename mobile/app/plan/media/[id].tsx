import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LocalizedError, uuid, type PlanDetail, type PlanItemDetail, type PlanItemSaveResult } from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { canLinkMedia, linkableMedia, mediaLinkBody, mediaListRequest, mediaSummaryLine } from '../../../src/lib/media-library';
import { orderWriteOutcome } from '../../../src/lib/plan-order-edit';
import { useAuth } from '../../../src/providers/AuthProvider';
import { Button, Card, EmptyState, ErrorNotice, Field, Label, ListRow, Loading, Screen, screenPadding } from '../../../src/components/ui';
import type { Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

const SEARCH_DELAY_MS = 300;

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * MOB-030: link a media bundle to a regular order item, or clear it (website
 * `LinkMediaModal`). One `setPlanItemMedia` write checked against the plan
 * revision shown; a changed plan is refused and re-read, never applied blind.
 */
export default function LinkMediaScreen() {
  const params = useLocalSearchParams<{ id?: string; itemId?: string }>();
  const { t } = useTranslation(['media', 'plans', 'common']);
  const { queryScope } = useAuth();
  const planId = uuid.safeParse(single(params.id));
  const itemId = uuid.safeParse(single(params.itemId));

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId.success ? planId.data : null),
    queryFn: () => api.getPlan(planId.success ? planId.data : ''),
    enabled: Boolean(queryScope && planId.success),
  });

  if (!planId.success || !itemId.success) {
    return (
      <Screen>
        <EmptyState title={t('mobileFiles.invalidLink')} />
      </Screen>
    );
  }
  if (plan.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (plan.error || !plan.data) {
    return (
      <Screen>
        <View style={{ padding: 24 }}>
          <ErrorNotice error={plan.error ?? new LocalizedError({ key: 'plans:planDetail.notFound' })} />
        </View>
      </Screen>
    );
  }
  const item = plan.data.items.find((candidate) => candidate.id === itemId.data);
  if (!item) {
    return (
      <Screen>
        <EmptyState title={t('mobileMedia.itemGone')} />
      </Screen>
    );
  }
  return <LinkMedia plan={plan.data} item={item} />;
}

interface LinkMediaProps {
  plan: PlanDetail;
  item: PlanItemDetail;
}

const LinkMedia = ({ plan, item }: LinkMediaProps) => {
  const { t } = useTranslation(['media', 'plans', 'common']);
  const { queryScope, generation, isCurrentGeneration, can } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const allowed = canLinkMedia(item, can('plans.edit', { serviceTypeId: plan.service_type_id }));
  const list = useQuery({
    queryKey: queryKeys.mediaList(queryScope, settled, false),
    queryFn: () => api.mediaList(mediaListRequest(settled, false)),
    enabled: Boolean(queryScope && allowed),
  });

  const save = useMutation({
    mutationFn: (mediaId: string | null): Promise<PlanItemSaveResult> =>
      api.setPlanItemMedia(plan.id, item.id, mediaLinkBody(mediaId, plan)),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.planAll(queryScope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mediaAll(queryScope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rehearsalAll(queryScope) }),
      ]);
      if (router.canGoBack()) router.back();
    },
    onError: async () => {
      // Whatever the answer, show the plan as it is now: a stale or gone item re-reads.
      if (isCurrentGeneration(generation)) await queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, plan.id) });
    },
  });
  const outcome = save.error ? orderWriteOutcome(save.error) : null;

  if (!allowed) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('linkMedia.title', { title: item.title }) }} />
        <EmptyState title={item.item_type === 'item' ? t('mobileMedia.noAccess') : t('mobileMedia.regularItemsOnly')} />
      </Screen>
    );
  }

  const rows = linkableMedia(list.data?.media ?? []);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('linkMedia.title', { title: item.title }) }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.stack]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {item.media ? (
          <Card>
            <Text style={styles.body}>
              {t(item.media.archived ? 'linkMedia.linkedArchived' : 'linkMedia.linked', { title: item.media.title }).replace(/<\/?\d>/g, '')}
            </Text>
            <Button
              title={t('linkMedia.removeLink')}
              variant="secondary"
              disabled={save.isPending}
              loading={save.isPending && save.variables === null}
              onPress={() => save.mutate(null)}
            />
          </Card>
        ) : null}

        {outcome === 'stale' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileMedia.stale')}</Text>
        ) : outcome === 'uncertain' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileMedia.uncertain')}</Text>
        ) : outcome === 'gone' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileMedia.linkGone')}</Text>
        ) : (
          <ErrorNotice error={save.error} />
        )}

        <Field label={t('linkMedia.find')} value={query} onChangeText={setQuery} placeholder={t('form.title')} autoCorrect={false} />
        <Card>
          <Label>{t('library.title')}</Label>
          {list.isLoading ? <Loading /> : null}
          <ErrorNotice error={list.error} />
          {!list.isLoading && !list.error && rows.length === 0 ? (
            <Text style={styles.muted}>{t('mobileMedia.noneFound')}</Text>
          ) : null}
          {rows.map((media, index) => {
            const linked = item.media?.id === media.id;
            return (
              <ListRow key={media.id} divided={index > 0}>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.body}>{media.title}</Text>
                    {mediaSummaryLine(media) ? <Text style={styles.muted}>{mediaSummaryLine(media)}</Text> : null}
                  </View>
                  <Button
                    title={linked ? t('linkMedia.linkedButton') : t('linkMedia.link')}
                    variant={linked ? 'primary' : 'secondary'}
                    accessibilityLabel={`${linked ? t('linkMedia.linkedButton') : t('linkMedia.link')}: ${media.title}`}
                    disabled={linked || save.isPending}
                    loading={save.isPending && save.variables === media.id}
                    onPress={() => save.mutate(media.id)}
                  />
                </View>
              </ListRow>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    stack: { gap: theme.space.lg },
    flex: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FileOwnerRef, PlanDetail, PlanFileEntry } from '@service-center/shared';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { fileErrorForDisplay, groupPlanFiles, planFileBadges, planFileEntryKey } from '../../lib/file-view';
import { useInvalidateFiles } from '../../lib/useFileUpload';
import { useAuth } from '../../providers/AuthProvider';
import { Button, Card, EmptyState, ErrorNotice, Label, Loading } from '../ui';
import { FileRow } from './FileRow';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';

export interface PlanFilesProps {
  plan: PlanDetail;
}

/**
 * MOB-026: the website's plan **Files** tab — plan files, then each item's
 * (song/arrangement files follow the song; linked defaults keep their pinned
 * version). The server returns only what this person's audience allows.
 */
export const PlanFiles = ({ plan }: PlanFilesProps) => {
  const { t } = useTranslation(['media', 'common']);
  const { queryScope } = useAuth();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [linking, setLinking] = useState(false);

  const files = useQuery({
    queryKey: queryKeys.planFiles(queryScope, plan.id),
    queryFn: () => api.planFiles(plan.id),
    enabled: Boolean(queryScope),
  });

  if (files.isLoading) return <Loading label={t('filesPanel.loading')} />;
  if (files.error || !files.data) {
    return (
      <Card>
        <ErrorNotice error={files.error} />
        <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void files.refetch()} />
      </Card>
    );
  }

  const { entries, can_edit: canEdit } = files.data;
  const groups = groupPlanFiles(entries);
  const items = plan.items.filter((item) => item.item_type !== 'header');
  const anyItemFiles = items.some((item) => groups.items.has(item.id));

  const openEntry = (entry: PlanFileEntry) =>
    router.push({
      pathname: '/files/[id]',
      params: {
        id: entry.file.id,
        planId: plan.id,
        ...(entry.plan_item_id ? { itemId: entry.plan_item_id } : {}),
        ...(entry.link ? { linkId: entry.link.id } : {}),
      },
    });
  const add = (owner: FileOwnerRef, context: string) =>
    router.push({ pathname: '/files/add', params: { ownerKind: owner.kind, ownerId: owner.id, planId: plan.id, context } });

  const renderEntries = (list: readonly PlanFileEntry[]) =>
    list.map((entry, index) => (
      <FileRow
        key={planFileEntryKey(entry)}
        file={entry.file}
        version={entry.version}
        badges={planFileBadges(entry)}
        divided={index > 0}
        onPress={() => openEntry(entry)}
      />
    ));

  return (
    <View style={styles.wrap}>
      <Text style={styles.intro}>{t('planFiles.intro')}</Text>

      <Card>
        <Label>{t('planFiles.thisPlan')}</Label>
        {groups.plan.length ? <View>{renderEntries(groups.plan)}</View> : <Text style={styles.muted}>{t('planFiles.noPlanFiles')}</Text>}
        {canEdit ? (
          <View style={styles.actions}>
            <Button title={t('mobileFiles.addFile')} icon="plus" variant="secondary" onPress={() => add({ kind: 'plan', id: plan.id }, plan.title)} />
            {plan.service_type_id ? (
              <Button title={t('planFiles.addDefault')} variant="secondary" onPress={() => setLinking((value) => !value)} />
            ) : null}
          </View>
        ) : null}
        {linking && plan.service_type_id ? (
          <LinkDefaults
            planId={plan.id}
            serviceTypeId={plan.service_type_id}
            linkedIds={new Set(entries.flatMap((entry) => (entry.link ? [entry.file.id] : [])))}
            onDone={() => setLinking(false)}
          />
        ) : null}
      </Card>

      <Card>
        <Label>{t('planFiles.items')}</Label>
        {!items.length ? <Text style={styles.muted}>{t('planFiles.noItems')}</Text> : null}
        {items.length > 0 && !anyItemFiles && !canEdit ? (
          <EmptyState title={t('planFiles.noItemFilesTitle')} description={t('planFiles.noItemFilesDescription')} />
        ) : null}
        {items.map((item) => {
          const list = groups.items.get(item.id) ?? [];
          if (!list.length && !canEdit) return null;
          return (
            <View key={item.id} style={styles.item}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {list.length ? <View>{renderEntries(list)}</View> : <Text style={styles.muted}>{t('planFiles.noFiles')}</Text>}
              {canEdit ? (
                <Button
                  title={t('mobileFiles.addFile')}
                  icon="plus"
                  variant="quiet"
                  onPress={() => add({ kind: 'plan_item', id: item.id }, item.title)}
                />
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
};

interface LinkDefaultsProps {
  planId: string;
  serviceTypeId: string;
  linkedIds: ReadonlySet<string>;
  onDone: () => void;
}

/** Puts one of the service type's default files on this plan, pinned to its current version (website `LinkDefaultModal`). */
const LinkDefaults = ({ planId, serviceTypeId, linkedIds, onDone }: LinkDefaultsProps) => {
  const { t } = useTranslation(['media', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const invalidate = useInvalidateFiles();
  const defaults = useQuery({
    queryKey: queryKeys.parentFiles(queryScope, 'service_type', serviceTypeId),
    queryFn: () => api.files('service_type', serviceTypeId),
    enabled: Boolean(queryScope),
  });
  const link = useMutation({
    mutationFn: (fileId: string) => api.linkFileToPlan(planId, { file_id: fileId, pin: true }),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await invalidate();
      onDone();
    },
  });
  const options = (defaults.data?.files ?? []).filter(
    (file) => !file.archived_at && !linkedIds.has(file.id) && (file.current_version || file.kind === 'link'),
  );

  return (
    <View style={styles.defaults}>
      {defaults.isLoading ? <Loading /> : null}
      <ErrorNotice error={defaults.error} />
      {defaults.data && !options.length ? <Text style={styles.muted}>{t('planFiles.allDefaultsLinked')}</Text> : null}
      {options.map((file) => (
        <View key={file.id} style={styles.defaultRow}>
          <Text style={styles.defaultTitle}>{file.title}</Text>
          <Button
            title={t('common:actions.add')}
            variant="secondary"
            loading={link.isPending && link.variables === file.id}
            disabled={link.isPending}
            onPress={() => link.mutate(file.id)}
          />
        </View>
      ))}
      <ErrorNotice error={fileErrorForDisplay(link.error)} />
      <Text style={styles.muted}>{t('planFiles.defaultPinHint')}</Text>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.lg },
    intro: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    item: { gap: theme.space.xs },
    itemTitle: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    defaults: { gap: theme.space.sm },
    defaultRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    defaultTitle: { ...theme.type.body, color: theme.color.ink, flex: 1 },
  });

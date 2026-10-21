import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  PLAN_ITEM_TYPES,
  initialArrangementFor,
  newPlanItemRequest,
  validateNewPlanItemDraft,
  type NewPlanItemDraft,
  type PlanItemType,
  type SongListItem,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { orderWriteOutcome } from '../../../src/lib/plan-order-edit';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
import { KeyPicker } from '../../../src/components/KeyPicker';
import { PressableScale } from '../../../src/components/motion';
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  Loading,
  Screen,
  SegmentedControl,
  screenPadding,
} from '../../../src/components/ui';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/**
 * MOB-014: the website's "Add to the order" on the same `addPlanItem` call
 * and the same body (shared `newPlanItemRequest`): a song with its main key,
 * a free-form item or a header, appended at the end. Arrangement, sequence,
 * timing segment and leader are then set in the item editor, as on the web.
 */
export default function AddPlanItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['plans', 'templates', 'common']);
  const { can, queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [itemType, setItemType] = useState<PlanItemType>('song');
  const [songQuery, setSongQuery] = useState('');
  const [song, setSong] = useState<SongListItem | null>(null);
  const [mainKey, setMainKey] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [length, setLength] = useState('');
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<LocalizedError | null>(null);

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });
  const songs = useQuery({
    queryKey: queryKeys.songs(queryScope, songQuery),
    queryFn: () => api.listSongs({ q: songQuery || undefined, per_page: 100 }),
    enabled: Boolean(queryScope && itemType === 'song'),
  });

  const draft: NewPlanItemDraft = { itemType, title, song, keyOverride: mainKey, length, description };
  const dirty = Boolean(song || title.trim() || length.trim() || description.trim());
  const guard = useDiscardGuard({
    dirty,
    message: t('editItem.discardConfirm'),
    keepLabel: t('mobileOrder.keepEditing'),
    discardLabel: t('mobileOrder.discard'),
  });

  const add = useMutation({
    mutationFn: () => api.addPlanItem(id!, newPlanItemRequest(draft, t('itemKind.song'))),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rehearsal(queryScope, id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
      ]);
      guard.leave();
    },
    // An add is not keyed: after no answer, show the order as it is now
    // rather than offering a blind retry that could add it twice.
    onError: (error) => {
      if (isCurrentGeneration(generation) && orderWriteOutcome(error) === 'uncertain') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, id) });
      }
    },
  });
  const uncertain = add.error ? orderWriteOutcome(add.error) === 'uncertain' : false;

  const submit = () => {
    const found = validateNewPlanItemDraft(draft);
    setProblem(found ? new LocalizedError({ key: `plans:editItem.errors.${found}` }) : null);
    if (found) return;
    add.mutate();
  };

  const chooseSong = (candidate: SongListItem) => {
    setSong(candidate);
    setMainKey(initialArrangementFor(candidate.arrangements)?.song_key ?? candidate.default_key ?? null);
    setProblem(null);
  };

  if (plan.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (!plan.data || !can('plans.edit', { serviceTypeId: plan.data.service_type_id })) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('addItem.title') }} />
        {plan.error ? <ErrorNotice error={plan.error} /> : <EmptyState title={t('templates:generate.noAccess')} />}
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('addItem.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        <SegmentedControl<PlanItemType>
          options={PLAN_ITEM_TYPES.map((value) => ({ value, label: t(`itemKind.${value}`) }))}
          value={itemType}
          onChange={(value) => {
            setItemType(value);
            setProblem(null);
          }}
        />

        {itemType === 'song' ? (
          <View style={styles.group}>
            <Field
              label={t('addItem.findSong')}
              value={songQuery}
              onChangeText={setSongQuery}
              placeholder={t('addItem.searchPlaceholder')}
              autoCorrect={false}
              returnKeyType="search"
            />
            {songs.isLoading ? <Loading /> : null}
            <ErrorNotice error={songs.error} />
            <View accessibilityRole="radiogroup" accessibilityLabel={t('addItem.findSong')}>
              {(songs.data?.data ?? []).slice(0, 30).map((candidate) => {
                const chosen = song?.id === candidate.id;
                return (
                  <PressableScale
                    key={candidate.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen }}
                    accessibilityLabel={[candidate.title, candidate.author, candidate.default_key].filter(Boolean).join(', ')}
                    onPress={() => chooseSong(candidate)}
                    pressedOpacity={0.6}
                    style={[styles.songRow, chosen && styles.songRowOn]}
                  >
                    <View style={styles.flex}>
                      <Text style={[styles.songTitle, chosen && styles.songTitleOn]}>{candidate.title}</Text>
                      {candidate.author ? <Text style={styles.muted}>{candidate.author}</Text> : null}
                    </View>
                    <Text style={styles.muted}>{candidate.default_key ?? ''}</Text>
                  </PressableScale>
                );
              })}
              {songs.data?.data.length === 0 ? <Text style={styles.muted}>{t('addItem.noSongs')}</Text> : null}
            </View>
            {song ? (
              <View style={styles.group}>
                <Label>{t('addItem.mainKey')}</Label>
                <KeyPicker value={mainKey} onChange={setMainKey} label={t('addItem.mainKey')} placeholder={t('addItem.chooseKey')} />
                <Text style={styles.hint}>{t('addItem.transposeHint')}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Field
            label={t('addItem.fieldTitle')}
            value={title}
            onChangeText={setTitle}
            placeholder={itemType === 'header' ? t('addItem.headerPlaceholder') : t('addItem.itemPlaceholder')}
            maxLength={200}
          />
        )}

        {itemType !== 'header' ? (
          <>
            <Field
              label={t('addItem.length')}
              value={length}
              onChangeText={setLength}
              placeholder="4:30"
              keyboardType="numbers-and-punctuation"
            />
            <Field
              label={t('addItem.notes')}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={4000}
              style={styles.multiline}
            />
          </>
        ) : null}

        <ErrorNotice error={problem} />
        {uncertain ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileOrder.addUncertain')}</Text>
        ) : (
          <ErrorNotice error={add.error} />
        )}
        <Button
          title={t('common:actions.add')}
          icon="plus"
          onPress={submit}
          loading={add.isPending}
          disabled={itemType === 'song' && !song}
        />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    flex: { flex: 1 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    multiline: { minHeight: 88, paddingTop: theme.space.sm, textAlignVertical: 'top' },
    songRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
      borderRadius: theme.radius.md,
    },
    songRowOn: { backgroundColor: theme.accent.blue.bg },
    songTitle: { ...theme.type.body, color: theme.color.ink },
    songTitleOn: { fontWeight: '600', color: theme.accent.blue.fg },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });

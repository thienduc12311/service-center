import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  PLAN_ITEM_TYPES,
  newPlanItemRequest,
  placePlanItem,
  validateNewPlanItemDraft,
  type CreatePlanItemRequest,
  type NewPlanItemDraft,
  type PlanDetail,
  type PlanItemType,
  type SongListItem,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { orderWriteOutcome, PlanItemAddAttempts, type PlanItemAddOwner } from '../../../src/lib/plan-order-edit';
import { songAddDraft } from '../../../src/lib/song-browser';
import { newIdempotencyKey } from '../../../src/lib/idempotency';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
import { SongBrowser } from '../../../src/components/song/SongBrowser';
import { PressableScale } from '../../../src/components/motion';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Screen,
  SegmentedControl,
  screenPadding,
} from '../../../src/components/ui';
import { type Theme } from '../../../src/lib/theme';
import { Icon } from '../../../src/components/icons';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/** Lives as long as the app process, so leaving and coming back keeps the retry key. */
const addAttempts = new PlanItemAddAttempts(newIdempotencyKey);

/** Route params: the plan, and optionally the item new ones go after ("Add songs after this"). */
type AddItemParams = {
  id: string;
  after?: string;
};

/** One add: whose it is, the body, and the label the next insert point is named by. */
interface AddRequest {
  owner: PlanItemAddOwner;
  body: CreatePlanItemRequest;
  title: string;
  songId: string | null;
}

interface AddResult {
  itemId: string;
  placed: boolean;
}

/** The item new ones go after, as shown above the list. */
interface InsertAnchor {
  id: string;
  title: string;
}

/**
 * MOB-014 + large-list review §3.1: songs are added from a full-screen
 * browser (Suggested / Recently added / All A–Z, filter chips, infinite
 * scroll); each [+] adds the song at once with its main key and the screen
 * stays open. Free-form items and headers keep the short form. Every add is
 * the shared `newPlanItemRequest` body, keyed (F11) so Retry after no answer
 * never adds twice. Opened from "Add songs after this", each add is followed
 * by one reorder that puts it after the chosen item, and the next song
 * follows the one just added.
 */
export default function AddPlanItemScreen() {
  const { id, after } = useLocalSearchParams<AddItemParams>();
  const { t } = useTranslation(['plans', 'templates', 'common']);
  const { can, queryScope } = useAuth();

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
    // Inserting needs the order as it is now, not as it was cached.
    refetchOnMount: 'always',
  });

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
        {plan.error ? <ErrorNotice error={plan.error} /> : <EmptyState icon="alert" title={t('templates:generate.noAccess')} />}
      </Screen>
    );
  }
  return <AddItems plan={plan.data} afterItemId={after ?? null} />;
}

interface AddItemsProps {
  plan: PlanDetail;
  /** From "Add songs after this"; null appends at the end. */
  afterItemId: string | null;
}

function AddItems({ plan, afterItemId }: AddItemsProps) {
  const { t } = useTranslation(['plans', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [itemType, setItemType] = useState<PlanItemType>('song');
  const [title, setTitle] = useState('');
  const [length, setLength] = useState('');
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const [addedSongIds, setAddedSongIds] = useState<ReadonlySet<string>>(() => new Set());
  const [addedCount, setAddedCount] = useState(0);
  const [lastRequest, setLastRequest] = useState<AddRequest | null>(null);
  const [placeFailed, setPlaceFailed] = useState(false);

  const initialAnchor = afterItemId ? plan.items.find((item) => item.id === afterItemId) : undefined;
  const [anchor, setAnchor] = useState<InsertAnchor | null>(initialAnchor ? { id: initialAnchor.id, title: initialAnchor.title } : null);
  const owner = useMemo<PlanItemAddOwner | null>(
    () => (queryScope ? { userId: queryScope.userId, organizationId: queryScope.organizationId } : null),
    [queryScope],
  );

  const draft: NewPlanItemDraft = { itemType, title, song: null, keyOverride: null, length, description };
  const dirty = itemType !== 'song' && Boolean(title.trim() || length.trim() || description.trim());
  const guard = useDiscardGuard({
    dirty,
    message: t('editItem.discardConfirm'),
    keepLabel: t('mobileOrder.keepEditing'),
    discardLabel: t('mobileOrder.discard'),
  });

  const add = useMutation({
    // Same body, same key: a retry returns the item the first attempt made.
    mutationFn: async (request: AddRequest): Promise<AddResult> => {
      const created = await api.addPlanItem(plan.id, addAttempts.next(request.owner, plan.id, request.body));
      addAttempts.settle(request.owner, plan.id);
      const placed = anchor === null || await placePlanItem(api, plan.id, created.id, anchor.id);
      return { itemId: created.id, placed };
    },
    onSuccess: (result, request) => {
      setLastRequest(null);
      setPlaceFailed(!result.placed);
      setAnchor((current) => current && result.placed ? { id: result.itemId, title: request.title } : null);
      setAddedCount((count) => count + 1);
      if (request.songId) {
        const songId = request.songId;
        setAddedSongIds((current) => new Set(current).add(songId));
      }
      if (!isCurrentGeneration(generation)) return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, plan.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rehearsal(queryScope, plan.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
      ]);
    },
    // After no answer the key is kept for Retry; any answer settles it.
    onError: (error, request) => {
      if (orderWriteOutcome(error) !== 'uncertain') addAttempts.settle(request.owner, plan.id);
      setLastRequest(request);
    },
  });
  const uncertain = add.error ? orderWriteOutcome(add.error) === 'uncertain' : false;

  const sendSong = (song: SongListItem) => {
    if (!owner || add.isPending) return;
    add.mutate({ owner, body: newPlanItemRequest(songAddDraft(song), t('itemKind.song')), title: song.title, songId: song.id });
  };
  const addSong = (song: SongListItem, inPlan: boolean) => {
    if (!inPlan) {
      sendSong(song);
      return;
    }
    Alert.alert(t('mobileSongBrowser.addAgainTitle', { title: song.title }), t('mobileSongBrowser.addAgainBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('mobileSongBrowser.addAgain'), onPress: () => sendSong(song) },
    ]);
  };

  const submitOther = () => {
    const found = validateNewPlanItemDraft(draft);
    setProblem(found ? new LocalizedError({ key: `plans:editItem.errors.${found}` }) : null);
    if (found || !owner) return;
    add.mutate(
      { owner, body: newPlanItemRequest(draft, t('itemKind.song')), title: title.trim(), songId: null },
      {
        onSuccess: (result) => {
          if (result.placed) {
            guard.leave();
            return;
          }
          // Saved with unconfirmed placement. Keep the notice visible and clear the form.
          setTitle('');
          setLength('');
          setDescription('');
        },
      },
    );
  };

  const retry = () => {
    if (lastRequest) add.mutate(lastRequest);
  };

  const appendInstead = () => setAnchor(null);

  const done = () => router.back();
  const screenTitle = itemType !== 'song'
    ? t('addItem.title')
    : addedCount > 0 ? t('mobileSongBrowser.titleAdded', { count: addedCount }) : t('mobileSongBrowser.title');

  const notices = (
    <>
      {anchor ? (
        <View style={styles.anchor}>
          <Icon name="move" size={15} color={theme.color.brandText} />
          <Text style={styles.anchorText} numberOfLines={2}>{t('mobileSongBrowser.insertingAfter', { title: anchor.title })}</Text>
          <Button title={t('mobileSongBrowser.insertAtEnd')} variant="quiet" disabled={add.isPending} onPress={appendInstead} />
        </View>
      ) : null}
      {placeFailed ? (
        <View accessibilityRole="alert" style={[styles.warning, styles.warningRow]}>
          <Icon name="alert" size={16} color={theme.accent.yellow.fg} />
          <Text style={styles.warningText}>{t('mobileSongBrowser.placeFailed')}</Text>
        </View>
      ) : null}
      {uncertain ? (
        <View accessibilityRole="alert" style={styles.warning}>
          <View style={styles.warningRow}>
            <Icon name="alert" size={16} color={theme.accent.yellow.fg} />
            <Text style={styles.warningText}>{t('mobileOrder.addUncertain')}</Text>
          </View>
          <Button variant="secondary" title={t('common:actions.retry')} onPress={retry} loading={add.isPending} />
        </View>
      ) : (
        <ErrorNotice error={add.error} />
      )}
    </>
  );

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: screenTitle,
          headerRight: () => (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('mobileSongBrowser.doneLabel')}
              onPress={done}
              pressedOpacity={0.6}
              hitSlop={8}
              style={styles.done}
            >
              <Text style={styles.doneText}>{t('common:actions.done')}</Text>
            </PressableScale>
          ),
        }}
      />
      <View style={styles.top}>
        <SegmentedControl<PlanItemType>
          options={PLAN_ITEM_TYPES.map((value) => ({ value, label: t(`itemKind.${value}`) }))}
          value={itemType}
          onChange={(value) => {
            setItemType(value);
            setProblem(null);
          }}
        />
      </View>

      {itemType === 'song' ? (
        <SongBrowser
          plan={plan}
          addedSongIds={addedSongIds}
          pendingSongId={add.isPending ? (add.variables?.songId ?? null) : null}
          busy={add.isPending}
          onAdd={addSong}
          notices={notices}
        />
      ) : (
        <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
          <Card>
            <Field
              label={t('addItem.fieldTitle')}
              value={title}
              onChangeText={setTitle}
              placeholder={itemType === 'header' ? t('addItem.headerPlaceholder') : t('addItem.itemPlaceholder')}
              maxLength={200}
            />
          </Card>

          {itemType !== 'header' ? (
            <Card>
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
            </Card>
          ) : null}

          <ErrorNotice error={problem} />
          {notices}
          <Button title={t('common:actions.add')} icon="plus" onPress={submitOther} loading={add.isPending} />
        </ScrollView>
      )}
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    top: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.md },
    form: { gap: theme.space.lg },
    multiline: { minHeight: 88, paddingTop: theme.space.sm, textAlignVertical: 'top' },
    done: { paddingHorizontal: theme.space.sm, minHeight: 36, justifyContent: 'center' },
    doneText: { ...theme.type.body, fontWeight: '600', color: theme.color.brandText },
    anchor: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      paddingLeft: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.accent.blue.bg,
    },
    anchorText: { ...theme.type.bodySmall, fontWeight: '600', color: theme.color.brandText, flex: 1 },
    warning: {
      gap: theme.space.md,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
    },
    warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
    warningText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, flex: 1 },
  });

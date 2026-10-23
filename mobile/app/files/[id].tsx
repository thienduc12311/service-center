import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  formatFileSize,
  translateMessage,
  uuid,
  type FileDetail,
  type FileVersionSummary,
  type PlanFileEntry,
  type SetFileLinkPinInput,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { useFormatters } from '../../src/i18n';
import {
  canSaveCopy,
  fileErrorForDisplay,
  fileKeyLabels,
  fileMetaParts,
  filePreviewMode,
  fileUploadOutcomeMessage,
  isFileAccessLost,
  linkHost,
  planFileBadges,
  planLinkActions,
  type PlanLinkAction,
} from '../../src/lib/file-view';
import { isUploadBusy } from '../../src/lib/file-upload';
import { useFileOpen } from '../../src/lib/useFileOpen';
import { useInvalidateFiles, useNativeFileUpload } from '../../src/lib/useFileUpload';
import { Button, Card, EmptyState, ErrorNotice, Label, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { FileDocumentView } from '../../src/components/files/FileDocumentView';
import { PickFileButtons, UploadStatus } from '../../src/components/files/UploadParts';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

interface FileRouteParams {
  id?: string;
  /** Opened from a plan: the plan entry decides the pinned version and link actions. */
  planId?: string;
  itemId?: string;
  linkId?: string;
}

const validId = (value: string | undefined): string | null => (uuid.safeParse(value).success ? value! : null);

/**
 * MOB-026: one F13 file — preview, versions, deliberate save/share, and for
 * writers the website's replace/archive/unfinished-upload actions. Every
 * open asks the server again; a refusal shows "no longer available" and
 * refreshes the lists. Details, audience, play-only and delete stay on the
 * website (stated on screen).
 */
export default function FileScreen() {
  const params = useLocalSearchParams<Record<keyof FileRouteParams, string>>();
  const id = validId(params.id);
  const { t } = useTranslation('media');
  if (!id) {
    return (
      <Screen>
        <EmptyState title={t('mobileFiles.invalidLink')} description={t('mobileFiles.invalidLinkDescription')} />
      </Screen>
    );
  }
  return <FileWorkspace key={id} id={id} planId={validId(params.planId)} itemId={validId(params.itemId)} linkId={validId(params.linkId)} />;
}

interface FileWorkspaceProps {
  id: string;
  planId: string | null;
  itemId: string | null;
  linkId: string | null;
}

const findEntry = (entries: readonly PlanFileEntry[], fileId: string, itemId: string | null, linkId: string | null) =>
  entries.find((entry) => (linkId ? entry.link?.id === linkId : entry.file.id === fileId && entry.plan_item_id === itemId)) ?? null;

function FileWorkspace({ id, planId, itemId, linkId }: FileWorkspaceProps) {
  const { t, i18n } = useTranslation(['media', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const invalidate = useInvalidateFiles();
  const opener = useFileOpen();
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A version chosen from the list (documents and images show it here). */
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: queryKeys.file(queryScope, id),
    queryFn: () => api.file(id),
    enabled: Boolean(queryScope),
  });
  const planFiles = useQuery({
    queryKey: queryKeys.planFiles(queryScope, planId),
    queryFn: () => api.planFiles(planId!),
    enabled: Boolean(queryScope && planId),
  });
  const file: FileDetail | undefined = detail.data;
  const entry = planId && planFiles.data ? findEntry(planFiles.data.entries, id, itemId, linkId) : null;
  const canEditPlan = planFiles.data?.can_edit ?? false;

  const arrangementId = file?.owner.kind === 'arrangement' ? file.owner.id : null;
  const materials = useQuery({
    queryKey: queryKeys.arrangementMaterials(queryScope, arrangementId),
    queryFn: () => api.getArrangementMaterials(arrangementId!),
    enabled: Boolean(queryScope && arrangementId),
  });
  const keyLabels = file ? fileKeyLabels(materials.data, file.id) : [];

  // The version this view uses: one picked from the list, else the plan's
  // pinned one, else the current one.
  const planVersion = entry ? entry.version : undefined;
  const baseVersion = file ? (planVersion === undefined ? file.current_version : planVersion) : null;
  const shown: FileVersionSummary | null = useMemo(() => {
    if (!file) return null;
    if (viewVersionId) return file.versions.find((version) => version.id === viewVersionId) ?? baseVersion;
    return baseVersion;
  }, [baseVersion, file, viewVersionId]);
  const mode = file ? filePreviewMode(file, shown) : 'none';

  const documentQuery = useQuery({
    queryKey: queryKeys.fileDocument(queryScope, id, shown && !shown.is_current ? shown.id : null),
    queryFn: () => api.fileDocument(id, shown && !shown.is_current ? shown.id : undefined),
    enabled: Boolean(queryScope && file && mode === 'document'),
  });

  // Images: one fresh inline link for the version shown, kept in screen
  // memory only; renewed once if the image fails (expired or replaced).
  const [image, setImage] = useState<{ versionId: string; url: string } | null>(null);
  const [imageError, setImageError] = useState<unknown>(null);
  const [imageRenewed, setImageRenewed] = useState(false);
  const loadImage = async (versionId: string) => {
    const started = generation;
    setImageError(null);
    try {
      const link = await api.fileDownload(id, { version_id: versionId, disposition: 'inline' });
      if (isCurrentGeneration(started)) setImage({ versionId, url: link.url });
    } catch (cause) {
      if (!isCurrentGeneration(started)) return;
      setImageError(cause);
      if (isFileAccessLost(cause)) await invalidate();
    }
  };
  useEffect(() => {
    if (mode !== 'image' || !shown || image?.versionId === shown.id) return;
    setImageRenewed(false);
    void loadImage(shown.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, shown?.id]);

  const replace = useNativeFileUpload((saved) => {
    setNotice(t('mobileFiles.replaced', { title: saved.title }));
    setViewVersionId(null);
  });
  const replacing = isUploadBusy(replace.state);

  const afterWrite = async () => {
    if (isCurrentGeneration(generation)) await invalidate();
  };
  const archive = useMutation({
    mutationFn: (current: FileDetail) => api.archiveFile(current.id, { archived: !current.archived_at, expected_revision: current.revision }),
    onSettled: afterWrite,
    onError: setActionError,
  });
  const discard = useMutation({
    mutationFn: (pending: FileVersionSummary) => api.abandonFileUpload(id, pending.id),
    onSettled: afterWrite,
    onError: setActionError,
  });
  const checkAgain = useMutation({
    mutationFn: (pending: FileVersionSummary) => api.finalizeFile(id, pending.id),
    onSuccess: (result) => {
      const message = fileUploadOutcomeMessage(result.outcome, result.reason);
      setNotice(message ? translateMessage(i18n, message) : t('mobileFiles.checkedReady'));
    },
    onSettled: afterWrite,
    onError: setActionError,
  });
  const pin = useMutation({
    mutationFn: ({ link, body }: { link: string; body: SetFileLinkPinInput }) => api.setFileLinkPin(link, body),
    onSuccess: () => setViewVersionId(null),
    onSettled: afterWrite,
    onError: setActionError,
  });
  const unlink = useMutation({
    mutationFn: (link: string) => api.unlinkFile(link),
    onSuccess: () => {
      if (isCurrentGeneration(generation)) router.back();
    },
    onSettled: afterWrite,
    onError: setActionError,
  });

  if (detail.isLoading) {
    return (
      <Screen>
        <Loading label={t('filesPanel.loading')} />
      </Screen>
    );
  }
  if (detail.error || !file) {
    const lost = isFileAccessLost(detail.error);
    return (
      <Screen>
        <View style={styles.errorWrap}>
          {lost ? (
            <EmptyState title={t('fileErrors.notFound')} description={t('mobileFiles.goneDescription')} />
          ) : (
            <>
              <ErrorNotice error={detail.error} />
              <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void detail.refetch()} />
            </>
          )}
        </View>
      </Screen>
    );
  }

  const meta = fileMetaParts(file, shown);
  const badges = entry ? planFileBadges(entry) : [];
  const linkActions = entry ? planLinkActions(entry, canEditPlan) : [];
  const saveAllowed = canSaveCopy(file, shown);
  const visibleVersions = file.versions.filter((version) => version.status === 'ready');

  const confirmExternal = () => {
    Alert.alert(t('mobileFiles.leaveAppTitle'), t('mobileFiles.leaveAppMessage', { host: linkHost(file.external_url) ?? '' }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('mobileFiles.openLink'), onPress: () => void opener.openExternal(file) },
    ]);
  };

  const share = async () => {
    setNotice(null);
    const result = await opener.share(file, shown, file.title);
    if (result === 'unavailable') setNotice(t('mobileFiles.shareUnavailable'));
  };

  const confirmArchive = () => {
    Alert.alert(
      file.archived_at ? t('mobileFiles.restoreConfirm', { title: file.title }) : t('mobileFiles.archiveConfirm', { title: file.title }),
      undefined,
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: file.archived_at ? t('common:actions.restore') : t('common:actions.archive'), onPress: () => archive.mutate(file) },
      ],
    );
  };

  const runLinkAction = (action: PlanLinkAction) => {
    const link = entry?.link;
    if (!link) return;
    setActionError(null);
    if (action === 'removeFromPlan') {
      Alert.alert(t('mobileFiles.removeFromPlanConfirm', { title: file.title }), t('mobileFiles.removeFromPlanHint'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('common:actions.remove'), style: 'destructive', onPress: () => unlink.mutate(link.id) },
      ]);
      return;
    }
    pin.mutate({ link: link.id, body: { mode: action === 'followNewest' ? 'follow' : 'current' } });
  };

  const metaText = [
    t(`files.categories.${file.category}`),
    t(`files.audiences.${file.audience}`),
    meta.versionNumber ? t('files.versionNumber', { number: meta.versionNumber }) : null,
    meta.size,
    meta.host,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen>
      <Stack.Screen options={{ title: file.title }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <View style={styles.hero}>
          <Text style={styles.title}>{file.title}</Text>
          <View style={styles.tags}>
            <Tag label={t(`files.kinds.${file.kind}`)} accent={theme.accent.neutral} />
            {file.archived_at ? <Tag label={t('files.archived')} accent={theme.accent.yellow} /> : null}
            {file.kind === 'upload' && file.playback_rights === 'stream_only' ? (
              <Tag label={t('files.playOnly')} accent={theme.accent.blue} />
            ) : null}
            {badges.map((badge) => (
              <Tag
                key={badge.kind}
                label={badge.kind === 'pinnedTo' ? t('planFiles.pinnedTo', { number: badge.number }) : t(`planFiles.${badge.kind}`)}
                accent={badge.kind === 'newerAvailable' ? theme.accent.yellow : theme.accent.blue}
              />
            ))}
            {keyLabels.map((label) => (
              <Tag key={label} label={t('mobileFiles.forKey', { key: label })} accent={theme.accent.green} />
            ))}
          </View>
          <Text style={styles.meta}>{metaText}</Text>
          {shown && !shown.is_current && file.kind !== 'link' ? (
            <Text style={styles.meta}>
              {t('mobileFiles.showingVersion', { number: shown.version_number ?? 0 })}
            </Text>
          ) : null}
        </View>

        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        <ErrorNotice error={fileErrorForDisplay(opener.error ?? actionError ?? imageError)} />

        <Card>
          <Label>{t('mobileFiles.preview')}</Label>
          {mode === 'document' ? (
            documentQuery.isLoading ? (
              <Loading />
            ) : documentQuery.data ? (
              <FileDocumentView body={documentQuery.data.body} />
            ) : (
              <ErrorNotice error={fileErrorForDisplay(documentQuery.error)} />
            )
          ) : null}
          {mode === 'image' ? (
            image && image.versionId === shown?.id ? (
              <Image
                source={{ uri: image.url }}
                style={styles.image}
                resizeMode="contain"
                accessibilityLabel={file.title}
                onError={() => {
                  // An expired or revoked link: ask once more (access rechecked).
                  if (imageRenewed || !shown) return;
                  setImageRenewed(true);
                  void loadImage(shown.id);
                }}
              />
            ) : imageError ? null : (
              <Loading />
            )
          ) : null}
          {mode === 'browser' ? (
            <View style={styles.section}>
              <Text style={styles.hint}>{t('mobileFiles.browserHint')}</Text>
              <Button title={t('common:actions.open')} icon="document" loading={opener.busy === 'open'} onPress={() => void opener.openInBrowser(file, shown)} />
            </View>
          ) : null}
          {mode === 'external' ? (
            <View style={styles.section}>
              <Text style={styles.hint}>{t('addFile.urlHint')}</Text>
              <Button title={t('mobileFiles.openLink')} loading={opener.busy === 'open'} onPress={confirmExternal} />
            </View>
          ) : null}
          {mode === 'none' ? (
            <Text style={styles.hint}>{meta.usable ? t('mobileFiles.noPreview') : t('files.noFinishedUpload')}</Text>
          ) : null}
        </Card>

        {file.kind === 'upload' && shown ? (
          <Card>
            <Label>{t('mobileFiles.saveCopy')}</Label>
            {saveAllowed ? (
              <>
                <Text style={styles.hint}>{t('mobileFiles.saveCopyHint')}</Text>
                <Button title={t('mobileFiles.saveCopyButton')} icon="upload" variant="secondary" loading={opener.busy === 'share'} onPress={() => void share()} />
              </>
            ) : (
              <Text style={styles.hint}>{t('fileErrors.streamOnly')}</Text>
            )}
          </Card>
        ) : null}

        {file.kind !== 'link' && visibleVersions.length > 1 ? (
          <Card>
            <Label>{t('versions.title', { title: file.title })}</Label>
            {visibleVersions.map((version) => (
              <View key={version.id} style={styles.versionRow}>
                <View style={styles.flex}>
                  <Text style={styles.versionTitle}>
                    {t('files.versionNumber', { number: version.version_number ?? 0 })}
                    {version.is_current ? ` ${t('versions.current')}` : ''}
                    {entry?.version?.id === version.id && entry.link?.pinned_version_id ? ` · ${t('mobileFiles.usedHere')}` : ''}
                  </Text>
                  <Text style={styles.meta}>
                    {[version.finalized_at ? format.dateTime(version.finalized_at) : null, formatFileSize(version.size_bytes) || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {shown?.id === version.id ? (
                  <Tag label={t('mobileFiles.shown')} accent={theme.accent.blue} />
                ) : (
                  <Button title={t('common:actions.view')} variant="quiet" onPress={() => setViewVersionId(version.id)} />
                )}
              </View>
            ))}
          </Card>
        ) : null}

        {linkActions.length ? (
          <Card>
            <Label>{t('mobileFiles.onThisPlan')}</Label>
            <Text style={styles.hint}>{t('planFiles.defaultPinHint')}</Text>
            {linkActions.map((action) => (
              <Button
                key={action}
                title={t(`planFiles.${action}`)}
                variant={action === 'removeFromPlan' ? 'quiet' : 'secondary'}
                loading={(action === 'removeFromPlan' ? unlink.isPending : pin.isPending)}
                onPress={() => runLinkAction(action)}
              />
            ))}
          </Card>
        ) : null}

        {file.can_edit ? (
          <Card>
            <Label>{t('mobileFiles.manage')}</Label>
            {file.kind === 'upload' && !file.archived_at ? (
              <View style={styles.section}>
                <Text style={styles.hint}>{t('mobileFiles.replaceHint')}</Text>
                <PickFileButtons
                  disabled={replacing}
                  onPicked={(picked) => {
                    setNotice(null);
                    void replace.start(picked, { kind: 'replace', file });
                  }}
                />
                <UploadStatus
                  state={replace.state}
                  onRetry={() => void replace.retry()}
                  onCancel={() => {
                    replace.cancel().catch(setActionError);
                  }}
                />
              </View>
            ) : null}

            {file.pending_versions.map((pending) => (
              <View key={pending.id} style={styles.pending}>
                <Text style={styles.hint}>
                  {pending.status === 'pending'
                    ? pending.upload_expires_at
                      ? t('files.pendingUpload', { filename: pending.filename, time: format.dateTime(pending.upload_expires_at) })
                      : t('files.pendingUploadSoon', { filename: pending.filename })
                    : t('files.failedUpload', {
                        filename: pending.filename,
                        reason: (() => {
                          const message = fileUploadOutcomeMessage(pending.status === 'expired' ? 'expired' : 'failed', pending.failure_reason);
                          return message ? translateMessage(i18n, message) : '';
                        })(),
                      })}
                </Text>
                {pending.status === 'pending' ? (
                  <View style={styles.row}>
                    <Button title={t('files.checkAgain')} variant="secondary" loading={checkAgain.isPending} onPress={() => checkAgain.mutate(pending)} />
                    <Button title={t('files.discard')} variant="quiet" loading={discard.isPending} onPress={() => discard.mutate(pending)} />
                  </View>
                ) : null}
              </View>
            ))}

            <Button
              title={file.archived_at ? t('common:actions.restore') : t('common:actions.archive')}
              variant="secondary"
              loading={archive.isPending}
              onPress={confirmArchive}
            />
            <Text style={styles.hint}>{t('mobileFiles.webOnly')}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    errorWrap: { padding: theme.space.xl, gap: theme.space.md },
    hero: { gap: theme.space.sm },
    title: { ...theme.type.display, color: theme.color.ink },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    notice: {
      ...theme.type.bodySmall,
      color: theme.accent.blue.fg,
      backgroundColor: theme.accent.blue.bg,
      padding: theme.space.md,
      borderRadius: theme.radius.sm,
    },
    section: { gap: theme.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    image: { width: '100%', aspectRatio: 1, borderRadius: theme.radius.sm, backgroundColor: theme.color.surfaceInset },
    versionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    versionTitle: { ...theme.type.body, color: theme.color.ink },
    pending: { gap: theme.space.sm },
  });

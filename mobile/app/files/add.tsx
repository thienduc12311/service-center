import { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FILE_DOCUMENT_MAX_CHARS,
  FILE_MAX_BYTES,
  formatFileSize,
  translateMessage,
  uuid,
  type FileCategory,
  type FileOwnerKind,
  type FileOwnerRef,
  type FileSummary,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { useDiscardGuard } from '../../src/lib/useDiscardGuard';
import { useInvalidateFiles, useNativeFileUpload } from '../../src/lib/useFileUpload';
import { checkPickedFile, isUploadBusy, type PickedDeviceFile } from '../../src/lib/file-upload';
import { audienceTargetsMissing, fileErrorForDisplay, fileUploadFailureMessage, type FileAudienceValue } from '../../src/lib/file-view';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, Card, Chip, EmptyState, ErrorNotice, Field, Label, Screen, SegmentedControl, screenPadding } from '../../src/components/ui';
import { AudiencePicker } from '../../src/components/files/AudiencePicker';
import { PickFileButtons, UploadStatus } from '../../src/components/files/UploadParts';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/** Upload a file from the device, add a web link or write a text document (website `AddFileModal`). */
type AddFileMode = 'upload' | 'link' | 'document';

/** Parents a phone may add files to; service-type defaults and media bundles stay on the website. */
const NATIVE_OWNER_KINDS: readonly FileOwnerKind[] = ['plan', 'plan_item', 'song', 'arrangement'];

const FILE_CATEGORIES: readonly FileCategory[] = ['chart', 'lyrics', 'audio', 'video', 'image', 'document', 'other'];

interface AddFileParams {
  ownerKind?: string;
  ownerId?: string;
  planId?: string;
  /** The parent's name, shown as context (display only). */
  context?: string;
}

const parseOwner = (params: AddFileParams): FileOwnerRef | null => {
  const kind = NATIVE_OWNER_KINDS.find((value) => value === params.ownerKind);
  const id = uuid.safeParse(params.ownerId);
  return kind && id.success ? { kind, id: id.data } : null;
};

/**
 * MOB-026: adds one F13 file under a plan, item, song or arrangement. The
 * server decides whether this person may (403/404 is shown as such); an
 * upload is only called saved once finalize says `ready`.
 */
export default function AddFileScreen() {
  const params = useLocalSearchParams<Record<keyof AddFileParams, string>>();
  const owner = parseOwner(params);
  const { t } = useTranslation(['media', 'common']);
  if (!owner) {
    return (
      <Screen>
        <EmptyState title={t('mobileFiles.invalidLink')} description={t('mobileFiles.invalidLinkDescription')} />
      </Screen>
    );
  }
  const planId = uuid.safeParse(params.planId).success ? params.planId! : null;
  return <AddFileForm owner={owner} planId={planId} context={typeof params.context === 'string' ? params.context : null} />;
}

interface AddFileFormProps {
  owner: FileOwnerRef;
  planId: string | null;
  context: string | null;
}

function AddFileForm({ owner, planId, context }: AddFileFormProps) {
  const { t, i18n } = useTranslation(['media', 'common']);
  const { generation, isCurrentGeneration } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const invalidate = useInvalidateFiles();
  const [mode, setMode] = useState<AddFileMode>('upload');
  const [audience, setAudience] = useState<FileAudienceValue>({ audience: 'organization', teamIds: [], positionIds: [] });
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FileCategory | null>(null);
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<PickedDeviceFile | null>(null);
  // One key per form: a double tap or a retry of Save is one link/document.
  const keyRef = useRef(newIdempotencyKey());
  const [saved, setSaved] = useState(false);

  const upload = useNativeFileUpload();
  const busy = isUploadBusy(upload.state);
  const pickedCheck = picked ? checkPickedFile(picked) : null;
  const pickedRefusal = pickedCheck && !pickedCheck.ok ? fileUploadFailureMessage(pickedCheck.failure) : null;

  const dirty =
    !saved && (busy || Boolean(picked) || title.trim() !== '' || url.trim() !== '' || body.trim() !== '');
  const guard = useDiscardGuard({
    dirty,
    message: busy ? t('mobileFiles.leaveUploading') : t('mobileFiles.discardDraft'),
    keepLabel: t('mobileFiles.keepEditing'),
    discardLabel: t('mobileFiles.discard'),
  });

  const save = useMutation({
    mutationFn: (): Promise<FileSummary> => {
      const shared = {
        owner,
        title: title.trim(),
        category: category ?? (mode === 'link' ? 'other' : 'document'),
        audience: audience.audience,
        team_ids: audience.teamIds,
        position_ids: audience.positionIds,
        idempotency_key: keyRef.current,
      } as const;
      return mode === 'link'
        ? api.createFileLink({ ...shared, url: url.trim() })
        : api.createFileDocument({ ...shared, body });
    },
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await invalidate();
      setSaved(true);
      guard.leave();
    },
  });

  const submit = async () => {
    if (mode !== 'upload') {
      save.mutate();
      return;
    }
    if (!picked) return;
    const file = await upload.start(picked, {
      kind: 'new',
      owner,
      audience: audience.audience,
      teamIds: audience.teamIds,
      positionIds: audience.positionIds,
      category: category ?? undefined,
      title: title.trim() || undefined,
    });
    if (file && isCurrentGeneration(generation)) {
      setSaved(true);
      guard.leave();
    }
  };

  const cancelUpload = () => {
    upload.cancel().catch(() => {
      // The intent stays as an unfinished upload writers can discard later.
    });
  };

  const canSubmit =
    !audienceTargetsMissing(audience) &&
    (mode === 'upload'
      ? Boolean(pickedCheck?.ok) && !busy
      : title.trim() !== '' && (mode === 'document' || url.trim() !== '') && !save.isPending);

  return (
    <Screen>
      <Stack.Screen options={{ title: t(`addFile.titles.${mode}`) }} />
      <ScrollView contentContainerStyle={screenPadding(theme)} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {context ? <Text style={styles.context}>{context}</Text> : null}
        <SegmentedControl<AddFileMode>
          options={[
            { value: 'upload', label: t('mobileFiles.modes.upload') },
            { value: 'link', label: t('mobileFiles.modes.link') },
            { value: 'document', label: t('mobileFiles.modes.document') },
          ]}
          value={mode}
          onChange={(next) => {
            if (busy) return;
            save.reset();
            setMode(next);
          }}
        />

        <Card>
          {mode === 'upload' ? (
            <View style={styles.section}>
              <Label>{t('addFile.file')}</Label>
              <PickFileButtons
                disabled={busy}
                onPicked={(file) => {
                  upload.reset();
                  setPicked(file);
                }}
              />
              {picked ? (
                <Text style={styles.picked}>
                  {picked.size !== null ? `${picked.name} · ${formatFileSize(picked.size)}` : picked.name}
                </Text>
              ) : null}
              {pickedRefusal ? (
                <Text accessibilityRole="alert" style={styles.refusal}>
                  {translateMessage(i18n, pickedRefusal)}
                </Text>
              ) : null}
              <Text style={styles.hint}>{t('addFile.fileHint', { size: formatFileSize(FILE_MAX_BYTES) })}</Text>
            </View>
          ) : null}

          <Field
            label={mode === 'upload' ? t('addFile.titleOptional') : t('addFile.title')}
            value={title}
            maxLength={200}
            placeholder={mode === 'upload' ? (picked?.name ?? t('addFile.titlePlaceholder')) : ''}
            onChangeText={setTitle}
            editable={!busy}
          />

          {mode === 'link' ? (
            <View style={styles.section}>
              <Field
                label={t('addFile.url')}
                value={url}
                placeholder="https://"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={setUrl}
              />
              <Text style={styles.hint}>{t('addFile.urlHint')}</Text>
            </View>
          ) : null}

          {mode === 'document' ? (
            <View style={styles.section}>
              <Field
                label={t('addFile.text')}
                value={body}
                multiline
                maxLength={FILE_DOCUMENT_MAX_CHARS}
                style={styles.body}
                onChangeText={setBody}
              />
              <Text style={styles.hint}>{t('addFile.textHint')}</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Label>{t('files.category')}</Label>
            <View style={styles.chips}>
              <Chip
                label={mode === 'upload' ? t('addFile.categoryFromType') : t('mobileFiles.categoryDefault')}
                active={category === null}
                onPress={() => setCategory(null)}
              />
              {FILE_CATEGORIES.map((value) => (
                <Chip key={value} label={t(`files.categories.${value}`)} active={category === value} onPress={() => setCategory(value)} />
              ))}
            </View>
          </View>

          <AudiencePicker ownerKind={owner.kind} planId={planId} value={audience} onChange={setAudience} />
        </Card>

        <UploadStatus state={upload.state} onRetry={() => void upload.retry()} onCancel={cancelUpload} />
        <ErrorNotice error={fileErrorForDisplay(save.error)} />

        <Button
          title={mode === 'upload' ? t('common:actions.upload') : t('common:actions.save')}
          icon={mode === 'upload' ? 'upload' : 'check'}
          loading={busy || save.isPending}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    context: { ...theme.type.label, color: theme.color.brandText },
    section: { gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    picked: { ...theme.type.body, color: theme.color.ink },
    refusal: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    body: { minHeight: 200, textAlignVertical: 'top', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  });

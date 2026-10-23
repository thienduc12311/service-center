import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatFileSize, translateMessage } from '@service-center/shared';
import { Button, ErrorNotice } from '../ui';
import { pickDeviceFile, type DevicePickSource } from '../../lib/file-pick';
import type { FileUploadState, PickedDeviceFile } from '../../lib/file-upload';
import { fileUploadFailureMessage } from '../../lib/file-view';
import { useAuth } from '../../providers/AuthProvider';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';
import { useErrorText } from '../../i18n/useErrorText';

export interface PickFileButtonsProps {
  disabled?: boolean;
  onPicked: (file: PickedDeviceFile) => void;
}

/**
 * MOB-026: Files or Photos. A refused photo permission is explained with a way
 * back (Settings, or Files instead) — nothing is retried behind the person's back.
 */
export const PickFileButtons = ({ disabled = false, onPicked }: PickFileButtonsProps) => {
  const { t } = useTranslation(['media', 'common']);
  const { generation, isCurrentGeneration } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [denied, setDenied] = useState(false);
  const [picking, setPicking] = useState<DevicePickSource | null>(null);
  const [error, setError] = useState<unknown>(null);

  const pick = async (source: DevicePickSource) => {
    const started = generation;
    setPicking(source);
    setError(null);
    try {
      const result = await pickDeviceFile(source);
      if (!isCurrentGeneration(started)) return;
      setDenied(result.kind === 'denied');
      if (result.kind === 'picked') onPicked(result.file);
    } catch (cause) {
      if (isCurrentGeneration(started)) setError(cause);
    } finally {
      if (isCurrentGeneration(started)) setPicking(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Button
          title={t('mobileFiles.pickFile')}
          icon="document"
          variant="secondary"
          disabled={disabled || picking !== null}
          loading={picking === 'files'}
          onPress={() => void pick('files')}
        />
        <Button
          title={t('mobileFiles.pickPhoto')}
          icon="image"
          variant="secondary"
          disabled={disabled || picking !== null}
          loading={picking === 'photos'}
          onPress={() => void pick('photos')}
        />
      </View>
      {denied ? (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={styles.noticeText}>{t('mobileFiles.photosDenied')}</Text>
          <Button title={t('mobileFiles.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      <ErrorNotice error={error} />
    </View>
  );
};

export interface UploadStatusProps {
  state: FileUploadState;
  onRetry: () => void;
  onCancel: () => void;
}

/** Honest progress: nothing is called saved until finalize says `ready`. */
export const UploadStatus = ({ state, onRetry, onCancel }: UploadStatusProps) => {
  const { t, i18n } = useTranslation(['media', 'common']);
  const styles = useThemedStyles(makeStyles);
  const errorText = useErrorText();

  if (state.phase === 'idle' || state.phase === 'done') return null;

  if (state.phase === 'failed') {
    const message = fileUploadFailureMessage(state.failure);
    const text = message
      ? translateMessage(i18n, message)
      : state.failure.kind === 'refused'
        ? errorText(state.failure.error)
        : t('upload.interrupted', { reason: state.failure.kind === 'interrupted' ? errorText(state.failure.error) : '' });
    return (
      <View accessibilityRole="alert" style={styles.failed}>
        <Text style={styles.failedText}>{text}</Text>
        {state.retryable ? (
          <View style={styles.row}>
            <Button title={t('common:actions.retry')} variant="secondary" onPress={onRetry} />
            <Button title={t('upload.cancel')} variant="quiet" onPress={onCancel} />
          </View>
        ) : null}
      </View>
    );
  }

  const fraction = state.phase === 'uploading' && state.total > 0 ? Math.min(1, state.loaded / state.total) : 0;
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Text style={styles.status}>
        {state.phase === 'preparing'
          ? t('upload.preparing')
          : state.phase === 'finalizing'
            ? t('upload.finalizing')
            : t('upload.progress', { loaded: formatFileSize(state.loaded), total: formatFileSize(state.total) })}
      </Text>
      {state.phase === 'uploading' ? (
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
        >
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
      ) : null}
      <Button title={t('upload.cancel')} variant="quiet" onPress={onCancel} />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    notice: { gap: theme.space.sm, backgroundColor: theme.accent.yellow.bg, padding: theme.space.md, borderRadius: theme.radius.sm },
    noticeText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    status: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    track: { height: 6, borderRadius: 3, backgroundColor: theme.color.surfaceInset, overflow: 'hidden' },
    fill: { height: 6, backgroundColor: theme.color.brand },
    failed: { gap: theme.space.sm, backgroundColor: theme.accent.red.bg, padding: theme.space.md, borderRadius: theme.radius.sm },
    failedText: { ...theme.type.bodySmall, color: theme.accent.red.fg },
  });

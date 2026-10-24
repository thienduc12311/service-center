import { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canAddScanPage, moveScanPage, removeScanPage, SCAN_MAX_PAGES, type ScanPage } from '../../lib/scan-pdf';
import { captureScanPage, clearScans, writeScanPdf, type ScanPageSource } from '../../lib/scan-capture';
import type { PickedDeviceFile } from '../../lib/file-upload';
import { useAuth } from '../../providers/AuthProvider';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';
import { Button, ErrorNotice, IconButton } from '../ui';

export interface ScanPagesProps {
  /** The reviewed PDF, handed to the normal upload as the picked file. */
  onDone: (file: PickedDeviceFile) => void;
  onCancel: () => void;
}

/** What the last capture attempt left to say. */
type ScanNotice = 'denied_camera' | 'denied_photos' | 'unavailable' | null;

/**
 * MOB-030 (iOS): scan pages into one PDF — take a photo of each page (or add
 * one from Photos), check them, reorder or remove, then make the PDF. Nothing
 * is uploaded here: the PDF becomes the file the person then uploads with the
 * usual audience and progress, and only a finished upload is saved.
 */
export const ScanPages = ({ onDone, onCancel }: ScanPagesProps) => {
  const { t } = useTranslation(['media', 'common']);
  const { generation, isCurrentGeneration } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [busy, setBusy] = useState<ScanPageSource | 'pdf' | null>(null);
  const [notice, setNotice] = useState<ScanNotice>(null);
  const [error, setError] = useState<unknown>(null);

  // Earlier scans' PDFs are not needed once a new scan starts.
  useEffect(clearScans, []);

  const add = async (source: ScanPageSource) => {
    const started = generation;
    setBusy(source);
    setNotice(null);
    setError(null);
    try {
      const result = await captureScanPage(source);
      if (!isCurrentGeneration(started)) return;
      if (result.kind === 'page') setPages((current) => (canAddScanPage(current) ? [...current, result.page] : current));
      else if (result.kind === 'denied') setNotice(result.source === 'camera' ? 'denied_camera' : 'denied_photos');
      else if (result.kind === 'unavailable') setNotice('unavailable');
    } catch (cause) {
      if (isCurrentGeneration(started)) setError(cause);
    } finally {
      if (isCurrentGeneration(started)) setBusy(null);
    }
  };

  const finish = async () => {
    const started = generation;
    setBusy('pdf');
    setError(null);
    try {
      const file = await writeScanPdf(pages);
      if (isCurrentGeneration(started)) onDone(file);
    } catch (cause) {
      if (isCurrentGeneration(started)) setError(cause);
    } finally {
      if (isCurrentGeneration(started)) setBusy(null);
    }
  };

  const full = !canAddScanPage(pages);

  return (
    <View style={styles.wrap}>
      <Text style={styles.body}>{t('mobileScan.intro')}</Text>
      <View style={styles.row}>
        <Button
          title={pages.length ? t('mobileScan.addPage') : t('mobileScan.takePhoto')}
          icon="camera"
          variant="secondary"
          disabled={busy !== null || full}
          loading={busy === 'camera'}
          onPress={() => void add('camera')}
        />
        <Button
          title={t('mobileScan.fromPhotos')}
          icon="image"
          variant="secondary"
          disabled={busy !== null || full}
          loading={busy === 'photos'}
          onPress={() => void add('photos')}
        />
      </View>
      {full ? <Text style={styles.muted}>{t('mobileScan.full', { count: SCAN_MAX_PAGES })}</Text> : null}
      {notice === 'unavailable' ? (
        <Text accessibilityRole="alert" style={styles.notice}>{t('mobileScan.noCamera')}</Text>
      ) : notice ? (
        <View accessibilityRole="alert" style={styles.noticeBox}>
          <Text style={styles.notice}>{notice === 'denied_camera' ? t('mobileScan.cameraDenied') : t('mobileFiles.photosDenied')}</Text>
          <Button title={t('mobileFiles.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}

      {pages.map((page, index) => (
        <View key={page.id} style={styles.page}>
          <Image
            source={{ uri: page.uri }}
            style={[styles.thumb, { aspectRatio: page.width / Math.max(page.height, 1) }]}
            resizeMode="contain"
            accessibilityLabel={t('mobileScan.pageLabel', { number: index + 1 })}
          />
          <View style={styles.pageSide}>
            <Text style={styles.body}>{t('mobileScan.pageLabel', { number: index + 1 })}</Text>
            <View style={styles.row}>
              <IconButton
                name="chevronUp"
                accessibilityLabel={t('mobileScan.moveUp', { number: index + 1 })}
                disabled={index === 0 || busy !== null}
                onPress={() => setPages((current) => moveScanPage(current, index, -1))}
              />
              <IconButton
                name="chevronDown"
                accessibilityLabel={t('mobileScan.moveDown', { number: index + 1 })}
                disabled={index === pages.length - 1 || busy !== null}
                onPress={() => setPages((current) => moveScanPage(current, index, 1))}
              />
              <IconButton
                name="trash"
                accessibilityLabel={t('mobileScan.remove', { number: index + 1 })}
                disabled={busy !== null}
                onPress={() => setPages((current) => removeScanPage(current, index))}
              />
            </View>
          </View>
        </View>
      ))}

      <ErrorNotice error={error} />
      {error ? <Text style={styles.muted}>{t('mobileScan.pdfFailed')}</Text> : null}
      <Button
        title={t('mobileScan.makePdf', { count: pages.length })}
        icon="document"
        disabled={pages.length === 0 || busy !== null}
        loading={busy === 'pdf'}
        onPress={() => void finish()}
      />
      <Button title={t('mobileScan.cancel')} variant="quiet" disabled={busy === 'pdf'} onPress={onCancel} />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.md },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, alignItems: 'center' },
    page: {
      flexDirection: 'row',
      gap: theme.space.md,
      padding: theme.space.sm,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.md,
    },
    thumb: { width: 96, maxHeight: 140, backgroundColor: theme.color.surface },
    pageSide: { flex: 1, gap: theme.space.sm, justifyContent: 'center' },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    notice: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    noticeBox: { gap: theme.space.sm },
  });

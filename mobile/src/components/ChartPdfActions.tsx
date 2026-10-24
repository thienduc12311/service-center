import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChartDocument } from '@service-center/shared';
import { isPrintDismissal, type ChartPdfAction, type ChartPdfState } from '../lib/chart-editing';
import { printChartPdf, shareChartPdf } from '../lib/chart-pdf';
import type { Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { Button } from './ui';

export interface ChartPdfActionsProps {
  /** The chart exactly as it is on screen; null when nothing printable is shown. */
  doc: ChartDocument | null;
  /** The document is an unsaved draft, so the PDF is said to be one. */
  unsaved?: boolean;
}

/**
 * MOB-029: the website's *Download PDF* on a phone — share the chart's PDF, or
 * open the OS print preview of its pages. Both write the same document the
 * screen shows, so the key, notation, sequence and layout are the ones read.
 */
export const ChartPdfActions = ({ doc, unsaved = false }: ChartPdfActionsProps) => {
  const { t } = useTranslation('songs');
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState<ChartPdfState>({ status: 'idle' });
  const busy = state.status === 'preparing';

  const run = async (action: ChartPdfAction) => {
    if (!doc || busy) return;
    setState({ status: 'preparing', action });
    try {
      const pages = action === 'share' ? await shareChartPdf(doc, t('mobileChartPdf.shareTitle')) : await printChartPdf(doc);
      setState({ status: 'done', action, pages });
    } catch (error) {
      if (action === 'print' && isPrintDismissal(error)) setState({ status: 'idle' });
      else setState({ status: 'failed', action, error });
    }
  };

  const status =
    state.status === 'preparing'
      ? t('mobileChartPdf.preparing')
      : state.status === 'failed'
        ? t('mobileChartPdf.failed')
        : state.status === 'done'
          ? t('mobileChartPdf.done', { count: state.pages })
          : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Button
          title={t('mobileChartPdf.share')}
          icon="upload"
          variant="secondary"
          style={styles.flex}
          disabled={!doc}
          loading={busy && state.action === 'share'}
          onPress={() => void run('share')}
        />
        <Button
          title={t('mobileChartPdf.print')}
          icon="document"
          variant="secondary"
          style={styles.flex}
          disabled={!doc}
          loading={busy && state.action === 'print'}
          onPress={() => void run('print')}
        />
      </View>
      {unsaved ? <Text style={styles.muted}>{t('mobileChartPdf.unsavedNote')}</Text> : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole={state.status === 'failed' ? 'alert' : undefined} style={state.status === 'failed' ? styles.error : styles.muted}>
          {status}
        </Text>
      ) : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    row: { flexDirection: 'row', gap: theme.space.sm },
    flex: { flex: 1 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    error: { ...theme.type.bodySmall, color: theme.accent.red.fg },
  });

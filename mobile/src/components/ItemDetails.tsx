import { Linking, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { parseItemDetails, type ItemDetailsBlock, type ItemDetailsRun, type MessageTextStyle } from '@service-center/shared';
import { fonts, type Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';

export interface ItemDetailsProps {
  /** The item's Markdown details. */
  markdown: string | null | undefined;
}

interface RunsProps {
  runs: readonly ItemDetailsRun[];
}

type Styles = ReturnType<typeof makeStyles>;

const runStyle = (styles: Styles, style: MessageTextStyle): StyleProp<TextStyle> => [
  style.bold && styles.bold,
  style.italic && styles.italic,
  style.strike && styles.strike,
  style.code && styles.code,
];

const Runs = ({ runs }: RunsProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      {runs.map((run, index) =>
        run.kind === 'link' ? (
          <Text key={index} accessibilityRole="link" onPress={() => void Linking.openURL(run.href)} style={[runStyle(styles, run.style), styles.link]}>
            {run.text}
          </Text>
        ) : (
          <Text key={index} style={runStyle(styles, run.style)}>{run.text}</Text>
        ),
      )}
    </>
  );
};

interface BlockProps {
  block: ItemDetailsBlock;
}

const Block = ({ block }: BlockProps) => {
  const styles = useThemedStyles(makeStyles);
  switch (block.kind) {
    case 'heading':
      return (
        <Text accessibilityRole="header" style={block.level === 1 ? styles.h1 : styles.h2}>
          <Runs runs={block.runs} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text selectable style={styles.body}>
          {block.lines.map((line, index) => (
            <Text key={index}>
              {index > 0 ? '\n' : ''}
              <Runs runs={line} />
            </Text>
          ))}
        </Text>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listRow}>
              <Text style={styles.marker}>{block.ordered ? `${block.start + index}.` : '•'}</Text>
              <Text selectable style={[styles.body, styles.flex]}>
                <Runs runs={item} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
};

/**
 * Read-only item details from the shared Markdown subset (the website's
 * renderer, natively): text runs only, so typed markup stays literal, and
 * only http, https and mailto links open.
 */
export function ItemDetails({ markdown }: ItemDetailsProps) {
  const styles = useThemedStyles(makeStyles);
  const blocks = parseItemDetails(markdown);
  if (blocks.length === 0) return null;
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => <Block key={index} block={block} />)}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    h1: { ...theme.type.heading, color: theme.color.ink },
    h2: { ...theme.type.label, color: theme.color.ink },
    list: { gap: theme.space.xs },
    listRow: { flexDirection: 'row', gap: theme.space.sm },
    marker: { ...theme.type.body, color: theme.color.inkMuted, minWidth: 16 },
    flex: { flex: 1 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    code: { fontFamily: fonts.mono, fontSize: 14, backgroundColor: theme.color.surfaceInset },
    link: { color: theme.color.brandText, textDecorationLine: 'underline' },
  });

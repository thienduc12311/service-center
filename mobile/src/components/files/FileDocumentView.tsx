import { StyleSheet, Text, View } from 'react-native';
import { parseFileDocument, type FileDocumentSpan } from '@service-center/shared';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';

export interface FileDocumentViewProps {
  body: string;
}

type DocumentStyles = ReturnType<typeof makeStyles>;

const renderSpans = (spans: readonly FileDocumentSpan[], styles: DocumentStyles) =>
  spans.map((span, index) => (
    <Text key={index} style={[span.bold && styles.bold, span.italic && styles.italic]}>
      {span.text}
    </Text>
  ));

/**
 * MOB-026: an F13 text document, rendered from the shared parser's structure
 * with ordinary text — markup is never interpreted, exactly as on the website.
 */
export const FileDocumentView = ({ body }: FileDocumentViewProps) => {
  const styles = useThemedStyles(makeStyles);
  const blocks = parseFileDocument(body);

  return (
    <View style={styles.document}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text key={index} accessibilityRole="header" style={[styles.heading, block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3]}>
              {renderSpans(block.spans, styles)}
            </Text>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listItem}>
                  <Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text>
                  <Text style={styles.paragraph}>
                    {renderSpans(item, styles)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={index} style={styles.paragraph}>
            {block.lines.map((line, lineIndex) => (
              <Text key={lineIndex}>
                {lineIndex > 0 ? '\n' : ''}
                {renderSpans(line, styles)}
              </Text>
            ))}
          </Text>
        );
      })}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    document: { gap: theme.space.md },
    heading: { color: theme.color.ink, fontWeight: '700' },
    h1: { ...theme.type.title },
    h2: { ...theme.type.body, fontSize: 18, lineHeight: 24 },
    h3: { ...theme.type.body },
    paragraph: { ...theme.type.body, color: theme.color.ink, flex: 1 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    list: { gap: theme.space.xs },
    listItem: { flexDirection: 'row', gap: theme.space.sm },
    marker: { ...theme.type.body, color: theme.color.inkMuted, minWidth: 20 },
  });

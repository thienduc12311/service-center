import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { IconButton } from './ui';

const SHEET_BACKDROP = 'rgba(15, 23, 42, 0.45)';

export interface BottomSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** The body; give a list `flex: 1` so it scrolls inside the sheet. */
  children: ReactNode;
  /** Pinned under the body (e.g. Done), above the home indicator. */
  footer?: ReactNode;
}

/**
 * A tall modal sheet for picking from a list: a fixed height, so a `FlatList`
 * or `SectionList` inside it virtualizes and scrolls on its own (never nested
 * in a `ScrollView`).
 */
export const BottomSheet = ({ visible, title, onClose, children, footer }: BottomSheetProps) => {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false} importantForAccessibility="no" />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + theme.space.md }]}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{title}</Text>
            <IconButton name="close" accessibilityLabel={t('actions.close')} onPress={onClose} />
          </View>
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: SHEET_BACKDROP },
    sheet: {
      height: '88%',
      backgroundColor: theme.color.surface,
      borderTopLeftRadius: theme.radius.lg + 2,
      borderTopRightRadius: theme.radius.lg + 2,
      paddingTop: theme.space.md,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      paddingHorizontal: theme.space.lg,
      paddingBottom: theme.space.sm,
    },
    title: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    body: { flex: 1, paddingHorizontal: theme.space.lg, gap: theme.space.sm },
    footer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.space.sm,
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },
  });

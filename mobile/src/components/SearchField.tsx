import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Icon } from './icons';

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Read by screen readers; defaults to the placeholder. */
  accessibilityLabel?: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The app's search box (magnifier + input), as on the People and Songs lists. */
export const SearchField = ({ value, onChangeText, placeholder, accessibilityLabel, autoFocus = false, style }: SearchFieldProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.search, style]}>
      <Icon name="search" size={17} color={theme.color.inkFaint} />
      <TextInput
        accessibilityLabel={accessibilityLabel ?? placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.inkFaint}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={styles.input}
      />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      minHeight: 46,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
      paddingHorizontal: theme.space.md,
    },
    input: { ...theme.type.body, lineHeight: undefined, flex: 1, color: theme.color.ink, paddingVertical: theme.space.sm + 2 },
  });

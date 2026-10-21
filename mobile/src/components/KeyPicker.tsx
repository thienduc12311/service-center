import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { keyGridFor, type KeyQuality } from '@service-center/shared';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { PressableScale } from './motion';
import { Icon } from './icons';
import { SegmentedControl } from './ui';

export interface KeyPickerProps {
  value: string | null;
  onChange: (key: string | null) => void;
  /** Accessible name of the field, e.g. "Service key". */
  label: string;
  /** Shown when nothing is chosen. */
  placeholder: string;
  /** A first choice that clears the key; omitted when not given. */
  resetLabel?: string;
}

/**
 * The website's key field (`KeySelect`) on native: a field that opens the
 * shared key grid — one letter per row, flats left and sharps right — with a
 * Major / Minor switch. Keys come from `keyGridFor`, so both clients offer
 * exactly the same spellings.
 */
export const KeyPicker = ({ value, onChange, label, placeholder, resetLabel }: KeyPickerProps) => {
  const { t } = useTranslation('songs');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<KeyQuality>(value?.endsWith('m') ? 'minor' : 'major');

  const choose = (key: string | null) => {
    onChange(key);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <PressableScale
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={[styles.field, open && styles.fieldOpen]}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>{value ?? placeholder}</Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} color={theme.color.inkMuted} />
      </PressableScale>
      {open ? (
        <View style={styles.panel}>
          {resetLabel ? (
            <PressableScale
              accessibilityRole="radio"
              accessibilityState={{ checked: value === null }}
              onPress={() => choose(null)}
              style={styles.reset}
            >
              <Text style={[styles.resetLabel, value === null && styles.resetLabelOn]}>{resetLabel}</Text>
            </PressableScale>
          ) : null}
          <SegmentedControl<KeyQuality>
            options={[
              { value: 'major', label: t('keySelect.quality.major') },
              { value: 'minor', label: t('keySelect.quality.minor') },
            ]}
            value={quality}
            onChange={setQuality}
          />
          <View accessibilityRole="radiogroup" accessibilityLabel={label}>
            {keyGridFor(quality).map((row, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {row.map((key, columnIndex) =>
                  key === null ? (
                    // Nobody writes B# or Cb: an empty spacer keeps the columns aligned.
                    <View key={`${rowIndex}-${columnIndex}`} style={[styles.cell, styles.cellEmpty]} />
                  ) : (
                    <PressableScale
                      key={key}
                      accessibilityRole="radio"
                      accessibilityLabel={key}
                      accessibilityState={{ checked: value === key }}
                      onPress={() => choose(key)}
                      style={[styles.cell, value === key && styles.cellOn]}
                    >
                      <Text style={[styles.cellLabel, value === key && styles.cellLabelOn]}>{key}</Text>
                    </PressableScale>
                  ),
                )}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    field: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.field,
      paddingHorizontal: theme.space.md,
    },
    fieldOpen: { borderColor: theme.color.brand },
    value: { ...theme.type.body, color: theme.color.ink },
    placeholder: { color: theme.color.inkFaint },
    panel: {
      gap: theme.space.sm,
      padding: theme.space.sm,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space.sm },
    resetLabel: { ...theme.type.bodySmall, color: theme.color.ink },
    resetLabelOn: { color: theme.color.brandText, fontWeight: '600' },
    row: { flexDirection: 'row', gap: theme.space.xs, marginTop: theme.space.xs },
    cell: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.surfaceInset,
    },
    cellEmpty: { opacity: 0.4 },
    cellOn: { backgroundColor: theme.color.brand },
    cellLabel: { ...theme.type.body, color: theme.color.ink },
    cellLabelOn: { color: theme.color.onBrand, fontWeight: '600' },
  });

import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  OPTION_CHIP_LIMIT,
  nextSelection,
  optionSections,
  selectedLabels,
  usesSearchableList,
  type OptionSection,
  type OptionSelectMode,
  type SearchableOption,
} from '../lib/option-groups';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { BottomSheet } from './BottomSheet';
import { Icon } from './icons';
import { PressableScale } from './motion';
import { SearchField } from './SearchField';
import { Button, Chip } from './ui';

export interface SearchableOptionSheetProps {
  visible: boolean;
  title: string;
  options: readonly SearchableOption[];
  selected: readonly string[];
  mode: OptionSelectMode;
  onChange: (next: string[]) => void;
  onClose: () => void;
  /** Group keys listed first (e.g. the plan's own service type). */
  leadingGroupKeys?: readonly string[];
  searchPlaceholder?: string;
  /** Single choice: a first row that clears the choice ("All teams", "None"). */
  emptyOptionLabel?: string;
}

/**
 * A searchable, grouped option list in a sheet. Single choice closes on a
 * pick; several choices toggle and close with Done. Search ignores accents
 * and matches every word, in the label, the group and the detail line.
 */
export const SearchableOptionSheet = ({
  visible,
  title,
  options,
  selected,
  mode,
  onChange,
  onClose,
  leadingGroupKeys,
  searchPlaceholder,
  emptyOptionLabel,
}: SearchableOptionSheetProps) => {
  const { t } = useTranslation('common');
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');
  const sections = useMemo(
    () => optionSections(options, query, { leadingGroupKeys }),
    [leadingGroupKeys, options, query],
  );

  const close = () => {
    setQuery('');
    onClose();
  };
  const pick = (value: string) => {
    onChange(nextSelection(mode, selected, value));
    if (mode === 'single') close();
  };

  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={close}
      footer={
        mode === 'multi' ? (
          <>
            <Text style={[styles.muted, styles.flex]}>{t('count.selected', { count: selected.length })}</Text>
            {selected.length ? <Button title={t('actions.clear')} variant="quiet" onPress={() => onChange([])} /> : null}
            <Button title={t('actions.done')} onPress={close} />
          </>
        ) : undefined
      }
    >
      <SearchField value={query} onChangeText={setQuery} placeholder={searchPlaceholder ?? t('optionPicker.search')} />
      <SectionList<SearchableOption, OptionSection>
        style={styles.flex}
        sections={sections}
        keyExtractor={(option) => option.value}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled
        ListHeaderComponent={
          mode === 'single' && emptyOptionLabel && !query.trim() ? (
            <OptionRow label={emptyOptionLabel} mode={mode} checked={selected.length === 0} onPress={() => { onChange([]); close(); }} />
          ) : null
        }
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null
        }
        renderItem={({ item, section }) => (
          <OptionRow
            label={section.title ? (item.groupedLabel ?? item.label) : item.label}
            detail={item.detail ?? null}
            mode={mode}
            checked={selected.includes(item.value)}
            onPress={() => pick(item.value)}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('optionPicker.noMatches')}</Text>}
      />
    </BottomSheet>
  );
};

interface OptionRowProps {
  label: string;
  detail?: string | null;
  mode: OptionSelectMode;
  checked: boolean;
  onPress: () => void;
}

/** A 44 pt radio or checkbox row. */
const OptionRow = ({ label, detail, mode, checked, onPress }: OptionRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole={mode === 'multi' ? 'checkbox' : 'radio'}
      accessibilityState={mode === 'multi' ? { checked } : { selected: checked }}
      accessibilityLabel={label}
      onPress={onPress}
      pressedOpacity={0.6}
      style={styles.row}
    >
      <View style={[mode === 'multi' ? styles.box : styles.radio, checked && styles.markOn]}>
        {checked ? <Icon name="check" size={13} color={theme.color.onBrand} strokeWidth={2.4} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.label, checked && styles.labelOn]}>{label}</Text>
        {detail ? <Text style={styles.muted}>{detail}</Text> : null}
      </View>
    </PressableScale>
  );
};

export interface SearchableOptionPickerProps {
  /** The sheet's title and the list's accessible name. */
  title: string;
  options: readonly SearchableOption[];
  selected: readonly string[];
  mode: OptionSelectMode;
  onChange: (next: string[]) => void;
  leadingGroupKeys?: readonly string[];
  searchPlaceholder?: string;
  /** Single choice: an option that clears the choice (first chip / first row). */
  emptyOptionLabel?: string;
  /** The button that opens the list when nothing is chosen; defaults to "Choose…". */
  chooseLabel?: string;
  /** Options up to this many stay chips (default 12). */
  chipLimit?: number;
}

/**
 * Chips while the options are few (no change for a small church); past the
 * limit, the current choice and a button that opens `SearchableOptionSheet`.
 */
export const SearchableOptionPicker = ({
  title,
  options,
  selected,
  mode,
  onChange,
  leadingGroupKeys,
  searchPlaceholder,
  emptyOptionLabel,
  chooseLabel,
  chipLimit = OPTION_CHIP_LIMIT,
}: SearchableOptionPickerProps) => {
  const { t } = useTranslation('common');
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);

  if (!usesSearchableList(options.length, chipLimit)) {
    return (
      <View accessibilityRole={mode === 'single' ? 'radiogroup' : undefined} accessibilityLabel={title} style={styles.chips}>
        {mode === 'single' && emptyOptionLabel ? (
          <Chip label={emptyOptionLabel} active={selected.length === 0} onPress={() => onChange([])} />
        ) : null}
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            toggle={mode === 'multi'}
            active={selected.includes(option.value)}
            onPress={() => onChange(nextSelection(mode, selected, option.value))}
          />
        ))}
      </View>
    );
  }

  const labels = selectedLabels(options, selected);
  const summary = labels.length === 0
    ? (emptyOptionLabel ?? null)
    : mode === 'single'
      ? labels[0]
      : t('optionPicker.selectedNames', { count: labels.length, names: labels.join(', ') });
  return (
    <View style={styles.picker}>
      {summary ? <Text style={styles.summary} numberOfLines={3}>{summary}</Text> : null}
      <Button
        title={labels.length ? t('optionPicker.change') : (chooseLabel ?? t('optionPicker.choose'))}
        accessibilityLabel={`${title}: ${labels.length ? t('optionPicker.change') : (chooseLabel ?? t('optionPicker.choose'))}`}
        variant="secondary"
        icon="search"
        onPress={() => setOpen(true)}
      />
      <Text style={styles.muted}>{t('optionPicker.optionCount', { count: options.length })}</Text>
      <SearchableOptionSheet
        visible={open}
        title={title}
        options={options}
        selected={selected}
        mode={mode}
        onChange={onChange}
        onClose={() => setOpen(false)}
        leadingGroupKeys={leadingGroupKeys}
        searchPlaceholder={searchPlaceholder}
        emptyOptionLabel={emptyOptionLabel}
      />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    picker: { gap: theme.space.sm, alignItems: 'flex-start' },
    summary: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    empty: { ...theme.type.bodySmall, color: theme.color.inkMuted, paddingVertical: theme.space.lg, textAlign: 'center' },
    sectionTitle: {
      ...theme.type.label,
      color: theme.color.inkMuted,
      backgroundColor: theme.color.surface,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      minHeight: 44,
      paddingVertical: theme.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
    label: { ...theme.type.body, color: theme.color.ink },
    labelOn: { fontWeight: '600' },
  });

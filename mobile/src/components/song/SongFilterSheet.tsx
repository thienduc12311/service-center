import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SONG_SPEEDS, SONG_TYPES, SONG_VOCABULARY_LABEL_KEYS, type SongListItem } from '@service-center/shared';
import { themeSuggestions } from '../../lib/song-browser';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';
import { BottomSheet } from '../BottomSheet';
import { KeyPicker } from '../KeyPicker';
import { SearchField } from '../SearchField';
import { Chip } from '../ui';

/** Which filter the sheet edits. */
export type SongFilterKind = 'key' | 'tempo' | 'theme' | 'type';

export interface SongFilterSheetProps {
  /** The filter being edited; null keeps the sheet closed. */
  kind: SongFilterKind | null;
  value: string | null;
  /** Songs loaded so far, for theme suggestions. */
  songs: readonly Pick<SongListItem, 'themes'>[];
  /** A value, or null for "any". */
  onChange: (value: string | null) => void;
  onClose: () => void;
}

/** Song vocabulary values are stored in English. */
export const useSongFacetLabel = (): ((value: string) => string) => {
  const { t } = useTranslation('songs');
  return (value) => {
    const key = SONG_VOCABULARY_LABEL_KEYS[value];
    return key ? t(key) : value;
  };
};

/** One filter chip's choices. */
export const SongFilterSheet = ({ kind, value, songs, onChange, onClose }: SongFilterSheetProps) => {
  const { t } = useTranslation('plans');
  const title = t(`mobileSongBrowser.filters.${kind ?? 'key'}`);
  const choose = (next: string | null) => {
    onChange(next);
    onClose();
  };
  return (
    <BottomSheet visible={kind !== null} title={title} onClose={onClose}>
      {kind === 'key' ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          <KeyPicker
            value={value}
            onChange={choose}
            label={t('mobileSongBrowser.filters.key')}
            placeholder={t('mobileSongBrowser.filters.anyKey')}
            resetLabel={t('mobileSongBrowser.filters.anyKey')}
            initiallyOpen
          />
        </ScrollView>
      ) : null}
      {kind === 'tempo' || kind === 'type' ? (
        <FacetChoices kind={kind} value={value} onChoose={choose} />
      ) : null}
      {kind === 'theme' ? <ThemeChoices value={value} songs={songs} onChoose={choose} /> : null}
    </BottomSheet>
  );
};

interface ChoiceListProps {
  value: string | null;
  onChoose: (value: string | null) => void;
}

interface FacetChoicesProps extends ChoiceListProps {
  kind: 'tempo' | 'type';
}

const FacetChoices = ({ kind, value, onChoose }: FacetChoicesProps) => {
  const { t } = useTranslation('plans');
  const styles = useThemedStyles(makeStyles);
  const facetLabel = useSongFacetLabel();
  const options = kind === 'tempo' ? SONG_SPEEDS : SONG_TYPES;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t(`mobileSongBrowser.filters.${kind}`)} style={styles.chips}>
      <Chip label={t(kind === 'tempo' ? 'mobileSongBrowser.filters.anyTempo' : 'mobileSongBrowser.filters.anyType')} active={value === null} onPress={() => onChoose(null)} />
      {options.map((option) => (
        <Chip key={option} label={facetLabel(option)} active={value === option} onPress={() => onChoose(option)} />
      ))}
    </View>
  );
};

interface ThemeChoicesProps extends ChoiceListProps {
  songs: readonly Pick<SongListItem, 'themes'>[];
}

/** A theme row in the list: "any", a typed value, or one found on a loaded song. */
interface ThemeRow {
  key: string;
  label: string;
  value: string | null;
}

const ThemeChoices = ({ value, songs, onChoose }: ThemeChoicesProps) => {
  const { t } = useTranslation('plans');
  const styles = useThemedStyles(makeStyles);
  const [typed, setTyped] = useState('');
  const rows = useMemo<ThemeRow[]>(() => {
    const found = themeSuggestions(songs, typed);
    const text = typed.trim();
    const exact = found.some((theme) => theme.toLowerCase() === text.toLowerCase());
    return [
      { key: 'any', label: t('mobileSongBrowser.filters.anyTheme'), value: null },
      ...(text && !exact ? [{ key: 'typed', label: t('mobileSongBrowser.filters.useTheme', { theme: text }), value: text }] : []),
      ...found.map((theme) => ({ key: `theme:${theme}`, label: theme, value: theme })),
    ];
  }, [songs, t, typed]);
  return (
    <>
      <SearchField value={typed} onChangeText={setTyped} placeholder={t('mobileSongBrowser.filters.themeSearch')} autoFocus />
      <Text style={styles.hint}>{t('mobileSongBrowser.filters.themeHint')}</Text>
      <FlatList
        style={styles.flex}
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.themeRow}>
            <Chip label={item.label} active={item.value === value} onPress={() => onChoose(item.value)} />
          </View>
        )}
      />
    </>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint, marginVertical: theme.space.sm },
    themeRow: { flexDirection: 'row', paddingVertical: theme.space.xs },
  });

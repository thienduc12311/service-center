import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SONG_VOCABULARY_LABEL_KEYS, songTag } from '@service-center/shared';
import type { LibraryWriteOutcome } from '../../lib/song-library';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';
import { Button, Card, Chip, ErrorNotice, Field, Label } from '../ui';

/** Captions for stored vocabulary values; the value itself is what is saved. */
export const useVocabularyLabel = (): ((value: string) => string) => {
  const { t } = useTranslation('songs');
  return (value: string) => {
    const key = SONG_VOCABULARY_LABEL_KEYS[value];
    return key ? t(key) : value;
  };
};

/** One choice in a chip row. */
export interface ChoiceOption {
  value: string;
  label: string;
}

/** A single choice (with an optional "none"), or several independent ones. */
export type ChoiceChipsProps =
  | {
      label: string;
      options: readonly ChoiceOption[];
      multiple?: false;
      /** Caption of the "nothing chosen" chip. */
      noneLabel: string;
      value: string | null;
      onChange: (value: string | null) => void;
    }
  | {
      label: string;
      options: readonly ChoiceOption[];
      multiple: true;
      values: readonly string[];
      onChangeValues: (values: string[]) => void;
    };

/**
 * The website's selects and tag pickers as wrapping chips: a radio row for a
 * single value, checkboxes for a list. Values outside the vocabulary (legacy
 * or typed on the website) stay listed so editing never drops them.
 */
export const ChoiceChips = (props: ChoiceChipsProps) => {
  const styles = useThemedStyles(makeStyles);
  const known = new Set(props.options.map((option) => option.value));
  const chosen = props.multiple ? props.values : props.value ? [props.value] : [];
  const extra = chosen.filter((value) => !known.has(value)).map((value) => ({ value, label: value }));
  const options = [...props.options, ...extra];

  return (
    <View style={styles.group}>
      <Label>{props.label}</Label>
      <View style={styles.chips} accessibilityLabel={props.label} accessibilityRole={props.multiple ? undefined : 'radiogroup'}>
        {props.multiple ? (
          options.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              toggle
              active={props.values.includes(option.value)}
              onPress={() =>
                props.onChangeValues(
                  props.values.includes(option.value)
                    ? props.values.filter((value) => value !== option.value)
                    : [...props.values, option.value],
                )
              }
            />
          ))
        ) : (
          <>
            <Chip label={props.noneLabel} active={props.value === null} onPress={() => props.onChange(null)} />
            {options.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={props.value === option.value}
                onPress={() => props.onChange(option.value)}
              />
            ))}
          </>
        )}
      </View>
    </View>
  );
};

export interface TagListFieldProps {
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
}

/**
 * Free-form tags (themes), as the website's `TagInput`: type one and add it;
 * tap a tag to remove it. Each tag is checked against the shared `songTag`
 * rule (1–40 characters) and duplicates are ignored.
 */
export const TagListField = ({ label, values, onChange }: TagListFieldProps) => {
  const { t } = useTranslation('songs');
  const styles = useThemedStyles(makeStyles);
  const [text, setText] = useState('');

  const add = () => {
    const parsed = songTag.safeParse(text);
    if (!parsed.success) return;
    if (!values.includes(parsed.data)) onChange([...values, parsed.data]);
    setText('');
  };

  return (
    <View style={styles.group}>
      <View style={styles.row}>
        <Field
          label={label}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          returnKeyType="done"
          maxLength={40}
          containerStyle={styles.flex}
        />
        <Button title={t('mobileAuthoring.addTag')} variant="secondary" onPress={add} disabled={!text.trim()} style={styles.addTag} />
      </View>
      {values.length ? (
        <View style={styles.chips}>
          {values.map((value) => (
            <Chip
              key={value}
              label={t('mobileAuthoring.removeTag', { tag: value })}
              toggle
              active
              onPress={() => onChange(values.filter((candidate) => candidate !== value))}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};

export interface RestoredDraftNoticeProps {
  onDiscard: () => void;
}

/** Says an unsaved draft from earlier was brought back, and offers to drop it. */
export const RestoredDraftNotice = ({ onDiscard }: RestoredDraftNoticeProps) => {
  const { t } = useTranslation('songs');
  const styles = useThemedStyles(makeStyles);
  return (
    <Card>
      <Text style={styles.body}>{t('mobileAuthoring.restored')}</Text>
      <Button title={t('mobileAuthoring.discardRestored')} variant="quiet" onPress={onDiscard} />
    </Card>
  );
};

export interface WriteProblemProps {
  error: unknown;
  outcome: LibraryWriteOutcome | null;
  /** Re-read the record and save the kept draft against it. */
  onLoadLatest: () => void;
  loadingLatest?: boolean;
}

/**
 * A failed save, worded by what it means for the kept draft: stale (someone
 * saved first; load the latest and save again), no answer (it may have
 * saved; trying again is checked against the same revision), gone, or the
 * server's own refusal.
 */
export const WriteProblem = ({ error, outcome, onLoadLatest, loadingLatest = false }: WriteProblemProps) => {
  const { t } = useTranslation('songs');
  const styles = useThemedStyles(makeStyles);
  if (!error || !outcome) return null;
  if (outcome === 'refused') return <ErrorNotice error={error} />;
  const text =
    outcome === 'stale'
      ? t('mobileAuthoring.stale')
      : outcome === 'uncertain'
        ? t('mobileAuthoring.uncertain')
        : t('mobileAuthoring.gone');
  return (
    <Card>
      <Text accessibilityRole="alert" style={styles.body}>{text}</Text>
      {outcome === 'stale' ? (
        <Button title={t('mobileAuthoring.loadLatest')} variant="secondary" loading={loadingLatest} onPress={onLoadLatest} />
      ) : null}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    group: { gap: theme.space.sm },
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm },
    addTag: { minHeight: 44 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink, marginBottom: theme.space.sm },
  });

import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  NOTE_AUDIENCE_ACCENTS,
  noteCategoryLabel,
  noteTeamNames,
  type NoteCategoryRow,
  type PlanNote,
} from '@service-center/shared';
import type { Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { useFormatters } from '../i18n';
import { Button, Divider, ErrorNotice, IconButton, Label, Loading, Tag } from './ui';

/** A team as note audiences name it. */
export interface NoteTeam {
  id: string;
  name: string;
}

export interface NoteListProps {
  notes: readonly PlanNote[];
  categories: readonly NoteCategoryRow[];
  teams: readonly NoteTeam[];
  canEdit: boolean;
  onEdit: (note: PlanNote) => void;
}

/**
 * The website's note list on native: category, who can read it, and the
 * text. Only notes the server returned are shown — the phone never receives
 * a note its reader may not see, so nothing is hidden here.
 */
export const NoteList = ({ notes, categories, teams, canEdit, onEdit }: NoteListProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View>
      {notes.map((note, index) => {
        const label = noteCategoryLabel(note.category_id, categories);
        const categoryName = label.kind === 'category'
          ? label.category.name
          : label.kind === 'general' ? t('noteEditor.general') : t('noteEditor.categoryUnavailable');
        const teamNames = note.audience === 'teams' ? noteTeamNames(note.team_ids, teams) : [];
        const audience = teamNames.length ? teamNames.join(', ') : t(`notesPanel.audienceShort.${note.audience}`);
        return (
          <View key={note.id}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.note}>
              <View style={styles.noteTop}>
                <Text style={styles.category}>{categoryName}</Text>
                {/* Tag aligns itself to the top; the wrapper centres it on the row. */}
                <View>
                  <Tag label={audience} accent={theme.accent[NOTE_AUDIENCE_ACCENTS[note.audience]]} />
                </View>
                <View style={styles.flex} />
                {canEdit ? (
                  <IconButton
                    name="pencil"
                    accessibilityLabel={`${t('common:actions.edit')}: ${categoryName}`}
                    onPress={() => onEdit(note)}
                  />
                ) : null}
              </View>
              <Text selectable style={styles.body}>{note.body}</Text>
              <Text style={styles.meta}>
                {[note.author_name ? t('mobileNotes.by', { name: note.author_name }) : null, format.dateTime(note.updated_at)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

export interface PlanNotesSectionProps {
  notes: readonly PlanNote[];
  categories: readonly NoteCategoryRow[];
  teams: readonly NoteTeam[];
  canEdit: boolean;
  loading: boolean;
  error: unknown;
  /** `plans.notes`: the simple note, readable by everyone, shown if the notes could not load. */
  simpleNote: string | null;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (note: PlanNote) => void;
}

/** MOB-016: the plan's Notes card (plan-level notes; item notes open from the order). */
export const PlanNotesSection = ({
  notes,
  categories,
  teams,
  canEdit,
  loading,
  error,
  simpleNote,
  onRetry,
  onAdd,
  onEdit,
}: PlanNotesSectionProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Label>{t('notesPanel.title')}</Label>
        {canEdit && !error ? <Button title={t('common:actions.add')} icon="plus" variant="quiet" onPress={onAdd} /> : null}
      </View>
      {loading ? (
        <Loading />
      ) : error ? (
        <View style={styles.wrap}>
          <ErrorNotice error={error} />
          {simpleNote ? (
            <>
              <Text style={styles.meta}>{t('mobileNotes.refreshFailed')}</Text>
              <Text selectable style={styles.body}>{simpleNote}</Text>
            </>
          ) : null}
          <Button title={t('common:actions.retry')} variant="secondary" onPress={onRetry} />
        </View>
      ) : notes.length === 0 ? (
        <Text style={styles.meta}>{t('notesPanel.empty')}</Text>
      ) : (
        <NoteList notes={notes} categories={categories} teams={teams} canEdit={canEdit} onEdit={onEdit} />
      )}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.sm },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    note: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    noteTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    category: { ...theme.type.bodySmall, color: theme.color.ink, fontWeight: '600' },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    meta: { ...theme.type.bodySmall, color: theme.color.inkFaint },
  });

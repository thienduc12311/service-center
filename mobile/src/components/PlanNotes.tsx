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
import { Button, Card, Divider, ErrorNotice, IconButton, IconWell, Loading, SectionHeader, Tag } from './ui';

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
              <Text style={styles.byline}>
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const showAdd = canEdit && !error;

  return (
    <View style={styles.wrap}>
      <SectionHeader
        title={t('notesPanel.title')}
        count={loading || error ? undefined : notes.length}
        actionLabel={showAdd ? t('common:actions.add') : undefined}
        onAction={showAdd ? onAdd : undefined}
      />
      {loading ? (
        <Card>
          <Loading />
        </Card>
      ) : error ? (
        <Card>
          <ErrorNotice error={error} />
          {simpleNote ? (
            <View style={styles.fallback}>
              <Text style={styles.meta}>{t('mobileNotes.refreshFailed')}</Text>
              <Text selectable style={styles.body}>{simpleNote}</Text>
            </View>
          ) : null}
          <Button title={t('common:actions.retry')} variant="secondary" onPress={onRetry} />
        </Card>
      ) : notes.length === 0 ? (
        <Card style={styles.emptyCard}>
          <IconWell name="document" accent={theme.accent.neutral} size={36} />
          <Text style={[styles.meta, styles.flex]}>{t('notesPanel.empty')}</Text>
        </Card>
      ) : (
        <Card compact>
          <NoteList notes={notes} categories={categories} teams={teams} canEdit={canEdit} onEdit={onEdit} />
        </Card>
      )}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.space.md },
    flex: { flex: 1 },
    fallback: { gap: theme.space.xs },
    emptyCard: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, padding: theme.space.md },
    note: { gap: 6, paddingVertical: theme.space.sm + 2 },
    noteTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    category: { ...theme.type.heading, fontSize: 15, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    byline: { ...theme.type.label, fontSize: 12, color: theme.color.inkFaint },
  });

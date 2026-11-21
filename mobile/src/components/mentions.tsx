import { useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  MENTION_PICKER_ROWS,
  activeMentionQuery,
  formatMessageText,
  insertMention,
  resolveMentionIds,
  splitMentions,
  type DiscussionMention,
  type MentionCandidate,
  type MentionQuery,
  type MessageTextStyle,
} from '@service-center/shared';
import { PressableScale } from './motion';
import { mentionSuggestions } from '../lib/mention-suggestions';
import { fonts, type Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';

/** Height of one picker row (pt): a full touch target. */
const PICKER_ROW = 44;

interface TextSelection {
  start: number;
  end: number;
}

export interface MentionInputOptions {
  text: string;
  onChangeText: (text: string) => void;
  candidates: readonly MentionCandidate[];
  /** People picked into this draft (kept by the caller, e.g. in a saved draft). */
  pickedIds: readonly string[];
  onPicked: (personId: string) => void;
  /** Offered first for an empty `@` (e.g. who spoke most recently); the rest follow, capped. */
  priorityIds?: readonly string[];
}

/** Props to spread on the `TextInput`; its text arrives as `children` (highlighted), not `value`. */
export interface MentionTextInputProps {
  onChangeText: (text: string) => void;
  onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  selection: TextSelection | undefined;
  children: ReactNode;
}

export interface MentionPickerState {
  open: boolean;
  matches: MentionCandidate[];
  onPick: (candidate: MentionCandidate) => void;
}

export interface MentionInput {
  inputProps: MentionTextInputProps;
  /** Set as the `TextInput`'s `ref` (so the `@` button can focus it). */
  inputRef: RefObject<TextInput | null>;
  picker: MentionPickerState;
  /** Return was pressed: picks the top match when the picker is open (and says so). */
  pickTopMatch: () => boolean;
  /** Types `@` at the caret and focuses the box so the picker opens (the `@` button). */
  startMention: () => void;
  /** Ids of picked people whose `@Name` is still intact in `text`. */
  mentionIds: (text: string) => string[];
}

/**
 * `@` mentions for a native text box: tracks the caret, offers matching
 * people while an `@query` is typed, inserts a pick, and highlights picked
 * names inside the box. Mirrors the website's `DiscussionComposer`.
 */
export function useMentionInput({ text, onChangeText, candidates, pickedIds, onPicked, priorityIds = [] }: MentionInputOptions): MentionInput {
  const styles = useThemedStyles(makeStyles);
  const input = useRef<TextInput>(null);
  const caret = useRef(text.length);
  const [, setCaretVersion] = useState(0);
  /** Caret to force after a programmatic edit; dropped once the box reports one. */
  const [forced, setForced] = useState<TextSelection | undefined>(undefined);

  const picked = pickedIds.flatMap((id) => candidates.filter((candidate) => candidate.person_id === id));
  const query: MentionQuery | null = activeMentionQuery(text, caret.current, picked);
  const matches = query ? mentionSuggestions(candidates, query.query, priorityIds) : [];
  const open = query !== null && (matches.length > 0 || query.query === '');

  const moveCaret = (next: number) => {
    caret.current = next;
    setCaretVersion((version) => version + 1);
  };

  const replace = (next: string, nextCaret: number) => {
    setForced({ start: nextCaret, end: nextCaret });
    moveCaret(nextCaret);
    onChangeText(next);
  };

  const onPick = (candidate: MentionCandidate) => {
    if (!query) return;
    const next = insertMention(text, query, candidate.name);
    if (!pickedIds.includes(candidate.person_id)) onPicked(candidate.person_id);
    replace(next.text, next.caret);
  };

  return {
    inputRef: input,
    inputProps: {
      onChangeText: (next) => {
        // Typing moves the caret by the change; the selection event that follows corrects it.
        moveCaret(Math.max(0, caret.current + next.length - text.length));
        onChangeText(next);
      },
      onSelectionChange: (event) => {
        setForced(undefined);
        moveCaret(event.nativeEvent.selection.start);
      },
      selection: forced,
      children: splitMentions(text, picked).map((segment, index) =>
        segment.kind === 'mention' ? (
          <Text key={index} style={styles.inputMention}>{segment.text}</Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        ),
      ),
    },
    picker: { open, matches, onPick },
    pickTopMatch: () => {
      const top = open ? matches[0] : undefined;
      if (!top) return false;
      onPick(top);
      return true;
    },
    startMention: () => {
      const at = Math.min(caret.current, text.length);
      const before = text.slice(0, at);
      const inserted = before === '' || /\s$/.test(before) ? '@' : ' @';
      replace(`${before}${inserted}${text.slice(at)}`, at + inserted.length);
      input.current?.focus();
    },
    mentionIds: (body) => resolveMentionIds(body, picked),
  };
}

export interface MentionPickerProps {
  picker: MentionPickerState;
}

/** The people an `@query` could mean, shown just above the text box. */
export function MentionPicker({ picker }: MentionPickerProps) {
  const { t } = useTranslation('messages');
  const styles = useThemedStyles(makeStyles);
  if (!picker.open) return null;
  return (
    <ScrollView
      accessibilityLabel={t('composer.mentionLabel')}
      keyboardShouldPersistTaps="always"
      style={[styles.picker, { maxHeight: PICKER_ROW * MENTION_PICKER_ROWS }]}
    >
      {picker.matches.length === 0 ? (
        <Text style={[styles.row, styles.empty]}>{t('composer.noOneToMention')}</Text>
      ) : (
        picker.matches.map((candidate, index) => (
          // PressableScale, not Pressable: NativeWind drops a function `style` on Pressable.
          <PressableScale
            key={candidate.person_id}
            accessibilityLabel={candidate.name}
            pressedOpacity={0.6}
            onPress={() => picker.onPick(candidate)}
            style={[styles.row, index === 0 && styles.rowTop]}
          >
            <Text style={styles.name} numberOfLines={1}>{candidate.name}</Text>
          </PressableScale>
        ))
      )}
    </ScrollView>
  );
}

/** `default` sits on a neutral surface; `inverse` on the author's brand-coloured bubble. */
export type MessageTone = 'default' | 'inverse';

export interface MessageBodyProps {
  text: string;
  mentions: readonly DiscussionMention[];
  tone?: MessageTone;
  style?: StyleProp<TextStyle>;
}

/**
 * Message text with its light formatting (bold, italic, strike, code), tappable
 * links, and each `@Name` of its mentions highlighted — the reader's own in
 * amber. Built from text runs only; typed markup is never interpreted.
 */
export function MessageBody({ text, mentions, tone = 'default', style }: MessageBodyProps) {
  const styles = useThemedStyles(makeStyles);
  const inverse = tone === 'inverse';
  const runStyle = (run: MessageTextStyle): StyleProp<TextStyle> => [
    run.bold && styles.bold,
    run.italic && styles.italic,
    run.strike && styles.strike,
    run.code && [styles.code, inverse && styles.codeInverse],
  ];
  return (
    <Text selectable style={style}>
      {formatMessageText(text, mentions).map((run, index) => {
        if (run.kind === 'mention') {
          return (
            <Text
              key={index}
              style={[runStyle(run.style), styles.mention, run.target.is_me ? styles.mentionMe : inverse ? styles.mentionInverse : styles.mentionDefault]}
            >
              {run.text}
            </Text>
          );
        }
        if (run.kind === 'link') {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(run.href)}
              style={[runStyle(run.style), styles.link, inverse && styles.linkInverse]}
            >
              {run.text}
            </Text>
          );
        }
        const formatted = runStyle(run.style);
        return run.style.bold || run.style.italic || run.style.strike || run.style.code
          ? <Text key={index} style={formatted}>{run.text}</Text>
          : run.text;
      })}
    </Text>
  );
}

/** The reader is among the people this entry mentions. */
export const mentionsMe = (mentions: readonly DiscussionMention[]): boolean => mentions.some((mention) => mention.is_me);

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    picker: {
      borderWidth: 1,
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface,
    },
    row: { minHeight: PICKER_ROW, justifyContent: 'center', paddingHorizontal: theme.space.md },
    rowTop: { backgroundColor: theme.color.surfaceInset },
    name: { ...theme.type.body, color: theme.color.ink },
    empty: { ...theme.type.body, color: theme.color.inkFaint, paddingVertical: theme.space.md },
    inputMention: { color: theme.accent.blue.fg, backgroundColor: theme.accent.blue.bg, fontWeight: '600' },
    mention: { fontWeight: '700' },
    mentionDefault: { color: theme.accent.blue.fg, backgroundColor: theme.accent.blue.bg },
    mentionInverse: { color: theme.color.onBrand, backgroundColor: 'rgba(255,255,255,0.22)' },
    mentionMe: { color: theme.accent.yellow.fg, backgroundColor: theme.accent.yellow.bg },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    code: { fontFamily: fonts.mono, fontSize: 14, backgroundColor: theme.color.surfaceInset },
    codeInverse: { backgroundColor: 'rgba(255,255,255,0.22)' },
    link: { color: theme.color.brandText, textDecorationLine: 'underline' },
    linkInverse: { color: theme.color.onBrand },
  });

import type { MentionTarget } from './mentions.js';
import { formatMessageText, type MessageTextStyle } from './message-format.js';

/**
 * Plan item details: a small, safe subset of Markdown shared by the website
 * (editor preview and the order) and the native app. Supported:
 *
 * - `#`, `##`, `###` headings;
 * - `-`, `*` or `+` bulleted and `1.` / `1)` numbered lists (one level);
 * - paragraphs (single line breaks are kept);
 * - inline `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `code` ``,
 *   `[label](url)` links and bare http(s) links.
 *
 * The text is only cut into blocks and styled runs; nothing is interpreted as
 * HTML, so typed markup such as `<script>` stays literal text. A link is kept
 * only for http, https and mailto URLs; any other target (`javascript:`,
 * `data:`, relative paths) shows its label as plain text.
 */

export type ItemDetailsRun =
  | { kind: 'text'; text: string; style: MessageTextStyle }
  | { kind: 'link'; text: string; href: string; style: MessageTextStyle };

export type ItemDetailsHeadingLevel = 1 | 2 | 3;

export type ItemDetailsBlock =
  | { kind: 'heading'; level: ItemDetailsHeadingLevel; runs: ItemDetailsRun[] }
  /** One run list per typed line. */
  | { kind: 'paragraph'; lines: ItemDetailsRun[][] }
  /** `start` is the first number of a numbered list (1 for bullets). */
  | { kind: 'list'; ordered: boolean; start: number; items: ItemDetailsRun[][] };

const NO_MENTIONS: readonly MentionTarget[] = [];
const SAFE_HREF = /^(?:https?:\/\/[^\s<>"'`\\]+|mailto:[^\s<>"'`\\/]+@[^\s<>"'`\\]+)$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)/g;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

/** The URL when it is an http, https or mailto link a reader may open; otherwise null. */
export const safeDetailsHref = (raw: string): string | null => {
  const href = raw.trim();
  if (!href || CONTROL.test(href) || !SAFE_HREF.test(href)) return null;
  return href;
};

const styledRuns = (text: string): ItemDetailsRun[] =>
  formatMessageText(text, NO_MENTIONS).flatMap((run): ItemDetailsRun[] => {
    if (run.kind === 'link') {
      const href = safeDetailsHref(run.href);
      return [href ? { kind: 'link', text: run.text, href, style: run.style } : { kind: 'text', text: run.text, style: run.style }];
    }
    if (!run.text) return [];
    return [{ kind: 'text', text: run.text, style: run.style }];
  });

/** One line of inline Markdown as styled runs. */
export const parseItemDetailsInline = (line: string): ItemDetailsRun[] => {
  const runs: ItemDetailsRun[] = [];
  let cursor = 0;
  for (const match of line.matchAll(MARKDOWN_LINK)) {
    runs.push(...styledRuns(line.slice(cursor, match.index)));
    const label = match[1]!;
    const href = safeDetailsHref(match[2]!);
    for (const run of styledRuns(label)) {
      runs.push(href ? { kind: 'link', text: run.text, href, style: run.style } : { kind: 'text', text: run.text, style: run.style });
    }
    cursor = match.index + match[0].length;
  }
  runs.push(...styledRuns(line.slice(cursor)));
  return runs;
};

type ListBlock = Extract<ItemDetailsBlock, { kind: 'list' }>;

/** The block being collected while lines are read. */
interface OpenBlocks {
  paragraph: ItemDetailsRun[][] | null;
  list: ListBlock | null;
}

/** The details as blocks; empty for blank text. */
export const parseItemDetails = (markdown: string | null | undefined): ItemDetailsBlock[] => {
  const blocks: ItemDetailsBlock[] = [];
  const open: OpenBlocks = { paragraph: null, list: null };
  const flush = () => {
    if (open.paragraph) blocks.push({ kind: 'paragraph', lines: open.paragraph });
    if (open.list) blocks.push(open.list);
    open.paragraph = null;
    open.list = null;
  };

  for (const line of (markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1]!.length as ItemDetailsHeadingLevel, runs: parseItemDetailsInline(heading[2]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const itemText = bullet ? bullet[1] : numbered?.[2];
    if (itemText !== undefined) {
      const ordered = Boolean(numbered);
      if (!open.list || open.list.ordered !== ordered) {
        flush();
        open.list = { kind: 'list', ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      }
      open.list.items.push(parseItemDetailsInline(itemText));
      continue;
    }
    if (open.list) flush();
    open.paragraph = [...(open.paragraph ?? []), parseItemDetailsInline(line)];
  }
  flush();
  return blocks;
};

/** The details as plain text (markers removed), e.g. for a one-line preview. */
export const itemDetailsPlainText = (markdown: string | null | undefined): string =>
  parseItemDetails(markdown)
    .map((block) => {
      const text = (runs: readonly ItemDetailsRun[]) => runs.map((run) => run.text).join('');
      if (block.kind === 'heading') return text(block.runs);
      if (block.kind === 'paragraph') return block.lines.map(text).join('\n');
      return block.items.map(text).join('\n');
    })
    .join('\n');

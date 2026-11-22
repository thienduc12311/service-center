/** A toolbar action of the item details editor. */
export type DetailsFormat = 'bold' | 'italic' | 'heading' | 'bulleted' | 'numbered' | 'link';

/** The textarea's text and selection before or after an action. */
export interface DetailsEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Words inserted when nothing is selected, in the displayed language. */
export interface DetailsPlaceholders {
  bold: string;
  italic: string;
  heading: string;
  listItem: string;
  link: string;
}

export const DETAILS_FORMATS: readonly DetailsFormat[] = ['bold', 'italic', 'heading', 'bulleted', 'numbered', 'link'];

const LINK_URL = 'https://';

const wrap = (edit: DetailsEdit, marker: string, placeholder: string): DetailsEdit => {
  const { value, selectionStart: start, selectionEnd: end } = edit;
  const selected = value.slice(start, end) || placeholder;
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  return { value: next, selectionStart: start + marker.length, selectionEnd: start + marker.length + selected.length };
};

/** Prefixes every line the selection touches (`prefix(n)` for the n-th line). */
const prefixLines = (edit: DetailsEdit, prefix: (index: number) => string, placeholder: string): DetailsEdit => {
  const { value, selectionStart: start, selectionEnd: end } = edit;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const body = lines
    .map((line, index) => `${prefix(index)}${line.replace(/^\s*(?:#{1,3}\s+|[-*+]\s+|\d{1,9}[.)]\s+)/, '') || (lines.length === 1 ? placeholder : '')}`)
    .join('\n');
  const next = `${value.slice(0, lineStart)}${body}${value.slice(lineEnd)}`;
  return { value: next, selectionStart: lineStart, selectionEnd: lineStart + body.length };
};

/** Applies one toolbar action to the text and selection. */
export const applyDetailsFormat = (edit: DetailsEdit, format: DetailsFormat, placeholders: DetailsPlaceholders): DetailsEdit => {
  switch (format) {
    case 'bold':
      return wrap(edit, '**', placeholders.bold);
    case 'italic':
      return wrap(edit, '_', placeholders.italic);
    case 'heading':
      return prefixLines(edit, () => '## ', placeholders.heading);
    case 'bulleted':
      return prefixLines(edit, () => '- ', placeholders.listItem);
    case 'numbered':
      return prefixLines(edit, (index) => `${index + 1}. `, placeholders.listItem);
    case 'link': {
      const { value, selectionStart: start, selectionEnd: end } = edit;
      const label = value.slice(start, end) || placeholders.link;
      const inserted = `[${label}](${LINK_URL})`;
      const urlStart = start + label.length + 3;
      // The URL is selected so it can be typed over.
      return { value: `${value.slice(0, start)}${inserted}${value.slice(end)}`, selectionStart: urlStart, selectionEnd: urlStart + LINK_URL.length };
    }
  }
};

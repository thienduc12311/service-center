/**
 * F13 file rules shared by the API, web and native clients. The database and
 * Storage enforce the same limits; these exist so a client can refuse early
 * and explain why.
 */
import type {
  FileAudience,
  FileCategory,
  FileFailureReason,
  FileFinalizeOutcome,
  FileOwnerKind,
  FileVersionSummary,
} from '../types/files.js';

/** Same list as the `attachments` bucket and `private.file_allowed_mime`. */
export const FILE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.recordare.musicxml+xml',
  'application/vnd.recordare.musicxml',
] as const;

export type FileMimeType = (typeof FILE_MIME_TYPES)[number];

/** 25 MiB — the bucket's limit. */
export const FILE_MAX_BYTES = 26_214_400;
/** Upload intents (and Supabase signed upload URLs) last two hours. */
export const FILE_UPLOAD_TTL_SECONDS = 7200;
/** Download links are short; ask again for a new one (access is rechecked). */
export const FILE_DOWNLOAD_TTL_SECONDS = 300;
export const FILE_DOCUMENT_MAX_CHARS = 100_000;

/** Browsers leave some types blank or vary them; map by extension as a fallback. */
const EXTENSION_TYPES: Record<string, FileMimeType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  txt: 'text/plain',
  cho: 'text/plain',
  chordpro: 'text/plain',
  md: 'text/markdown',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  mxl: 'application/vnd.recordare.musicxml',
};

export const isAllowedFileMimeType = (value: string): value is FileMimeType =>
  (FILE_MIME_TYPES as readonly string[]).includes(value);

/** The type to declare for a picked file, or null when it is not supported. */
export const resolveFileMimeType = (filename: string, reportedType: string | null | undefined): FileMimeType | null => {
  const reported = (reportedType ?? '').toLowerCase();
  if (isAllowedFileMimeType(reported)) return reported;
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_TYPES[extension] ?? null;
};

export const fileCategoryForMimeType = (mimeType: string): FileCategory => {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf' || mimeType.includes('musicxml')) return 'chart';
  return 'document';
};

/** Shown inline in a browser rather than only saved. */
export const isInlinePreviewable = (mimeType: string): boolean =>
  mimeType === 'application/pdf' ||
  mimeType.startsWith('image/') ||
  mimeType.startsWith('audio/') ||
  mimeType.startsWith('video/') ||
  mimeType === 'text/plain' ||
  mimeType === 'text/markdown';

export const formatFileSize = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  chart: 'Chart',
  lyrics: 'Lyrics',
  audio: 'Audio',
  video: 'Video',
  image: 'Image',
  document: 'Document',
  other: 'Other',
};

export const FILE_AUDIENCE_LABELS: Record<FileAudience, string> = {
  organization: 'Everyone in the organization',
  scheduled: 'People scheduled on this plan',
  teams: 'Selected teams',
  positions: 'Selected positions',
  leaders: 'Leaders only',
};

/** `scheduled` only means something on a plan or one of its items. */
export const fileAudiencesFor = (owner: FileOwnerKind): FileAudience[] =>
  owner === 'plan' || owner === 'plan_item'
    ? ['organization', 'scheduled', 'teams', 'positions', 'leaders']
    : ['organization', 'teams', 'positions', 'leaders'];

/** What to tell the person when an upload did not become a file version. */
export const fileUploadOutcomeMessage = (
  outcome: FileFinalizeOutcome,
  reason: FileFailureReason | null | undefined,
): string | null => {
  if (outcome === 'ready') return null;
  if (outcome === 'not_uploaded') return 'The upload has not reached storage yet. Try again.';
  if (outcome === 'expired') return 'This upload expired before it finished. Upload the file again.';
  switch (reason) {
    case 'size_mismatch':
      return 'The stored file is not the size that was announced, so it was discarded. Upload it again.';
    case 'type_mismatch':
      return 'The stored file is not the type that was announced, so it was discarded. Upload it again.';
    case 'superseded':
      return 'Someone replaced this file while you were uploading. Your upload was not applied; upload again to replace the newer version.';
    case 'abandoned':
      return 'This upload was cancelled.';
    default:
      return 'The upload could not be completed. Upload the file again.';
  }
};

export const fileVersionLabel = (version: Pick<FileVersionSummary, 'version_number' | 'status'>): string =>
  version.version_number ? `v${version.version_number}` : version.status === 'pending' ? 'Uploading' : 'Not saved';

// ------------------------------------------------------------- documents --
/**
 * Text documents use a small allowlisted subset of Markdown: `#`/`##`/`###`
 * headings, `-`/`*` bullets, `1.` numbered items, `**bold**`, `*italic*` or
 * `_italic_`, and paragraphs. Anything else is plain text. The parser returns
 * structure, never HTML, so clients render it with ordinary text elements.
 */
export interface FileDocumentSpan {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type FileDocumentBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: FileDocumentSpan[] }
  | { type: 'paragraph'; lines: FileDocumentSpan[][] }
  | { type: 'list'; ordered: boolean; items: FileDocumentSpan[][] };

/** Splits `**bold**` and `*italic*`/`_italic_` runs; unmatched markers stay literal. */
export const parseFileDocumentInline = (text: string): FileDocumentSpan[] => {
  const spans: FileDocumentSpan[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: text.slice(last, index), bold: false, italic: false });
    if (match[1] !== undefined) spans.push({ text: match[1], bold: true, italic: false });
    else spans.push({ text: match[2] ?? match[3] ?? '', bold: false, italic: true });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false, italic: false });
  return spans.filter((span) => span.text.length > 0);
};

export const parseFileDocument = (body: string): FileDocumentBlock[] => {
  const blocks: FileDocumentBlock[] = [];
  let paragraph: FileDocumentSpan[][] | null = null;
  let list: { ordered: boolean; items: FileDocumentSpan[][] } | null = null;
  const flush = (): void => {
    if (paragraph) blocks.push({ type: 'paragraph', lines: paragraph });
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    paragraph = null;
    list = null;
  };

  for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        spans: parseFileDocumentInline(heading[2]!),
      });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = Boolean(numbered && !bullet);
      if (paragraph || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(parseFileDocumentInline(item[1]!));
      continue;
    }
    if (list) flush();
    paragraph ??= [];
    paragraph.push(parseFileDocumentInline(line.trim()));
  }
  flush();
  return blocks;
};

/**
 * Phase 2 — turn a photographed or scanned chord sheet into ChordPro.
 *
 * The pipeline is deliberately split in two:
 *   1. a provider transcribes the image to plain text, preserving the column
 *      positions of chords above lyrics;
 *   2. `chordLinesToChordPro` (in @service-center/shared, fully unit-tested)
 *      converts that text into ChordPro.
 *
 * Keeping step 2 deterministic means the fiddly part — chord placement — is
 * testable without spending a single API call.
 */

import { chordLinesToChordPro, detectKey } from '@service-center/shared';
import { config } from '../config.js';
import { adminDb } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export interface OcrResult {
  rawText: string;
  title: string | null;
  key: string | null;
  confidence: number | null;
  provider: string;
}

export interface OcrProvider {
  readonly name: string;
  recognise(image: { base64: string; mimeType: string; filename: string | null }): Promise<OcrResult>;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

export const mimeTypeFor = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'image/jpeg';
};

// ------------------------------------------------------------------ stub ---
/** Returns a fixture so the whole import flow works with no credentials. */
const stubProvider: OcrProvider = {
  name: 'stub',
  async recognise() {
    return {
      rawText: [
        'Verse 1',
        'G            C        G',
        'Amazing grace how sweet the sound',
        '                        D',
        'That saved a wretch like me',
        'G            C          G',
        'I once was lost, but now am found',
        '     Em      D        G',
        'Was blind but now I see',
      ].join('\n'),
      title: 'Amazing Grace',
      key: 'G',
      confidence: 0.5,
      provider: 'stub',
    };
  },
};

// ------------------------------------------------------------- anthropic ---
const TRANSCRIPTION_PROMPT = `You are transcribing a chord sheet from an image.

Reproduce the sheet as plain text, exactly as laid out:
- Keep chords on their own line, positioned in the same columns as they appear above the lyric they fall on. Use spaces for alignment, never tabs.
- Keep section headings (Verse 1, Chorus, Bridge, Tag) on their own line.
- Do not add, correct or reharmonise chords. Transcribe what you can see.
- Do not convert to ChordPro or any other format.

Respond with a single JSON object and nothing else:
{"title": string|null, "key": string|null, "confidence": number between 0 and 1, "text": string}

"confidence" is your confidence in the transcription's accuracy. "text" is the transcription with \\n for newlines.`;

const parseJsonResponse = (text: string): Record<string, unknown> => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    // The model answered in prose; treat the whole reply as the transcription
    // rather than failing the import outright.
    return { text, title: null, key: null, confidence: null };
  }
};

const createAnthropicProvider = (): OcrProvider => ({
  name: 'anthropic',
  async recognise(image) {
    if (!config.ANTHROPIC_API_KEY) {
      throw new HttpError(500, 'OCR_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is not set');
    }

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            image.mimeType === 'application/pdf'
              ? {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: image.base64 },
                }
              : {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: image.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
                    data: image.base64,
                  },
                },
            { type: 'text', text: TRANSCRIPTION_PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new HttpError(422, 'The transcription request was declined');
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const parsed = parseJsonResponse(text);
    const confidence = Number(parsed.confidence);

    return {
      rawText: String(parsed.text ?? ''),
      title: typeof parsed.title === 'string' ? parsed.title : null,
      key: typeof parsed.key === 'string' ? parsed.key : null,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : null,
      provider: 'anthropic',
    };
  },
});

let provider: OcrProvider | null = null;

export const ocrProvider = (): OcrProvider => {
  provider ??= config.OCR_PROVIDER === 'anthropic' ? createAnthropicProvider() : stubProvider;
  return provider;
};

/** Test seam — swap in a fake provider. */
export const setOcrProvider = (next: OcrProvider): void => {
  provider = next;
};

// ------------------------------------------------------------- pipeline ---
/**
 * Runs an import to completion. Called in the background after the row is
 * created, and again on demand via POST /imports/:id/retry. Failures are
 * recorded on the row rather than thrown, so the client can show and retry.
 */
export const processImport = async (importId: string): Promise<void> => {
  const { data: record } = await adminDb
    .from('chord_sheet_imports')
    .select('*')
    .eq('id', importId)
    .maybeSingle();

  if (!record) return;

  await adminDb
    .from('chord_sheet_imports')
    .update({ status: 'processing', processing_started_at: new Date().toISOString(), error_message: null })
    .eq('id', importId);

  try {
    const { data: file, error } = await adminDb.storage
      .from('chord-sheets')
      .download(record.storage_path.replace(/^chord-sheets\//, ''));

    if (error || !file) {
      throw new Error(`Could not read the uploaded file: ${error?.message ?? 'not found'}`);
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const result = await ocrProvider().recognise({
      base64,
      mimeType: mimeTypeFor(record.storage_path),
      filename: record.original_filename,
    });

    const chordpro = chordLinesToChordPro(result.rawText, {
      title: result.title,
      key: result.key ?? detectKey(result.rawText),
    });

    await adminDb
      .from('chord_sheet_imports')
      .update({
        status: 'succeeded',
        provider: result.provider,
        raw_text: result.rawText,
        parsed_chordpro: chordpro,
        detected_title: result.title,
        detected_key: result.key ?? detectKey(result.rawText),
        confidence: result.confidence,
        processing_finished_at: new Date().toISOString(),
      })
      .eq('id', importId);
  } catch (err) {
    await adminDb
      .from('chord_sheet_imports')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        processing_finished_at: new Date().toISOString(),
      })
      .eq('id', importId);
  }
};

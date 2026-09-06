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

const TRANSCRIPTION_TEMPERATURE = 0;

/** Narrows the parsed transcription payload into an `OcrResult`. */
const toOcrResult = (text: string, providerName: string): OcrResult => {
  const parsed = parseJsonResponse(text);
  const confidence = Number(parsed.confidence);
  return {
    rawText: String(parsed.text ?? ''),
    title: typeof parsed.title === 'string' ? parsed.title : null,
    key: typeof parsed.key === 'string' ? parsed.key : null,
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : null,
    provider: providerName,
  };
};

/** Reads an error body without letting a huge HTML page into the log. */
const describeHttpFailure = async (provider: string, response: Response): Promise<HttpError> => {
  const body = (await response.text().catch(() => '')).slice(0, 500);
  return new HttpError(502, `The ${provider} transcription request failed (${response.status}): ${body}`);
};

// ---------------------------------------------------------------- gemini ---
interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Google AI Studio. The free tier is what makes this the default real
 * provider; the REST endpoint keeps it dependency-free.
 */
const createGeminiProvider = (): OcrProvider => ({
  name: 'gemini',
  async recognise(image) {
    if (!config.GEMINI_API_KEY) {
      throw new HttpError(500, 'OCR_PROVIDER is "gemini" but GEMINI_API_KEY is not set');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inline_data: { mime_type: image.mimeType, data: image.base64 } },
                { text: TRANSCRIPTION_PROMPT },
              ],
            },
          ],
          generationConfig: {
            temperature: TRANSCRIPTION_TEMPERATURE,
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    if (response.status === 429) {
      throw new HttpError(429, 'The transcription provider is rate limiting; try again shortly');
    }
    if (!response.ok) throw await describeHttpFailure('Gemini', response);

    const body = (await response.json()) as GeminiResponse;
    if (body.promptFeedback?.blockReason) {
      throw new HttpError(422, `The transcription request was declined (${body.promptFeedback.blockReason})`);
    }

    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();

    if (!text) throw new HttpError(502, 'Gemini returned an empty transcription');
    return toOcrResult(text, 'gemini');
  },
});

// ---------------------------------------------------------------- openai ---
interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  error?: { message?: string };
}

const createOpenAiProvider = (): OcrProvider => ({
  name: 'openai',
  async recognise(image) {
    if (!config.OPENAI_API_KEY) {
      throw new HttpError(500, 'OCR_PROVIDER is "openai" but OPENAI_API_KEY is not set');
    }
    if (image.mimeType === 'application/pdf') {
      throw new HttpError(422, 'The OpenAI provider reads images, not PDFs — upload a photo or a PNG');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        temperature: TRANSCRIPTION_TEMPERATURE,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: TRANSCRIPTION_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
              },
            ],
          },
        ],
      }),
    });

    if (response.status === 429) {
      throw new HttpError(429, 'The transcription provider is rate limiting; try again shortly');
    }
    if (!response.ok) throw await describeHttpFailure('OpenAI', response);

    const body = (await response.json()) as OpenAiResponse;
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new HttpError(502, 'OpenAI returned an empty transcription');
    return toOcrResult(text, 'openai');
  },
});

// ------------------------------------------------------------- anthropic ---
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

    return toOcrResult(text, 'anthropic');
  },
});

let provider: OcrProvider | null = null;

const PROVIDER_FACTORIES: Record<typeof config.OCR_PROVIDER, () => OcrProvider> = {
  stub: () => stubProvider,
  gemini: createGeminiProvider,
  openai: createOpenAiProvider,
  anthropic: createAnthropicProvider,
};

export const ocrProvider = (): OcrProvider => {
  provider ??= PROVIDER_FACTORIES[config.OCR_PROVIDER]();
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

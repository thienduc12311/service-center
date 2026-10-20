/**
 * The language-preference lifecycle shared by the web and native adapters:
 * which language to display, where it came from, and how a member's saved
 * choice is cached, reconciled and saved. Framework-free; storage, device
 * detection, connectivity and the API are injected.
 *
 * Guarantees:
 * - A saved preference is cached per Profile *and* Organization, so another
 *   church or another account on the same device never selects it.
 * - Responses that arrive after the context changed (sign-out, account or
 *   church switch) are ignored.
 * - Automatically detected languages are never written as a preference.
 * - A save shows the new language while pending, prevents duplicate
 *   submissions, and restores the previous language if it fails.
 */

import { ApiError } from '../lib/api-client.js';
import { localeRegistry, type LocaleRegistry, type SupportedLocale } from './locales.js';
import { resolveLocale, type LocaleResolution } from './resolve-locale.js';

/** Who the UI is showing, for language purposes. */
export type LanguageContext =
  | { kind: 'anonymous' }
  | { kind: 'member'; profileId: string; organizationId: string };

/** Minimal key/value storage (localStorage or AsyncStorage). */
export interface LanguageStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

/** The self-service API, scoped to the context's church. */
export interface LanguagePreferenceApi<Code extends string = SupportedLocale> {
  load(context: Extract<LanguageContext, { kind: 'member' }>): Promise<{ preferred_language: string | null; person_linked?: boolean }>;
  save(
    context: Extract<LanguageContext, { kind: 'member' }>,
    preferred: Code | null,
  ): Promise<{ preferred_language: string | null }>;
}

export type LanguagePreferenceErrorKind = 'save_failed' | 'offline' | 'link_required' | 'load_failed';

export type LanguagePreferenceStatus = 'idle' | 'loading' | 'saving' | 'error';

export interface LanguagePreferenceState<Code extends string = SupportedLocale> {
  context: LanguageContext;
  /** The member's saved value for this church (null = Automatic); may be a code this client lacks. */
  saved: string | null;
  /** Whether `saved` came from the server or the cache yet (false while unknown). */
  savedKnown: boolean;
  /** False when the server reports no Person linked to this login in this church. */
  personLinked: boolean | null;
  /** Explicit signed-out choice on this device. */
  anonymousChoice: Code | null;
  /** A verified token page's recipient preference; display only, never saved. */
  recipientHint: string | null;
  /** The value being saved; `undefined` when no save is in flight. */
  pending: Code | null | undefined;
  status: LanguagePreferenceStatus;
  error: LanguagePreferenceErrorKind | null;
  /** What to display right now. */
  resolution: LocaleResolution<Code>;
}

/** What the selector should show as chosen: the pending value while saving, else the saved one. */
export const selectedPreference = <Code extends string>(state: LanguagePreferenceState<Code>): string | null =>
  state.context.kind === 'anonymous'
    ? state.anonymousChoice
    : state.pending !== undefined
      ? state.pending
      : state.saved;

export type SaveOutcome = 'saved' | 'busy' | 'offline' | 'link_required' | 'failed' | 'stale' | 'invalid';

export interface LanguagePreferenceControllerOptions<Code extends string = SupportedLocale> {
  storage: LanguageStorage;
  api: LanguagePreferenceApi<Code>;
  /** Browser/device languages, most preferred first; re-read on every resolution. */
  detectLocales: () => readonly string[];
  /** Connectivity hint; saving requires a connection in this release. */
  isOnline?: () => boolean;
  registry?: LocaleRegistry<Code>;
}

export const ANONYMOUS_LANGUAGE_KEY = 'service-center.language.device';
export const ACCOUNT_LANGUAGE_CACHE_KEY = 'service-center.language.accounts';

type MemberContext = Extract<LanguageContext, { kind: 'member' }>;
type AccountCache = Record<string, string | null>;

const cacheKey = (context: MemberContext): string => `${context.profileId}:${context.organizationId}`;

const sameContext = (a: LanguageContext, b: LanguageContext): boolean =>
  a.kind === b.kind &&
  (a.kind === 'anonymous' ||
    (b.kind === 'member' && a.profileId === b.profileId && a.organizationId === b.organizationId));

const parseCache = (raw: string | null): AccountCache => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const cache: AccountCache = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value === 'string') cache[key] = value;
    }
    return cache;
  } catch {
    // A corrupt cache only costs a server round trip; start clean.
    return {};
  }
};

export class LanguagePreferenceController<Code extends string = SupportedLocale> {
  private state: LanguagePreferenceState<Code>;
  private readonly listeners = new Set<(state: LanguagePreferenceState<Code>) => void>();
  private readonly registry: LocaleRegistry<Code>;
  /** Bumped on every context change; async work from an older epoch is dropped. */
  private epoch = 0;

  constructor(private readonly options: LanguagePreferenceControllerOptions<Code>) {
    this.registry = options.registry ?? (localeRegistry as unknown as LocaleRegistry<Code>);
    const base = {
      context: { kind: 'anonymous' } as LanguageContext,
      saved: null,
      savedKnown: false,
      personLinked: null,
      anonymousChoice: null,
      recipientHint: null,
      pending: undefined,
      status: 'idle' as const,
      error: null,
    };
    this.state = { ...base, resolution: this.resolve(base) };
  }

  getState = (): LanguagePreferenceState<Code> => this.state;

  subscribe = (listener: (state: LanguagePreferenceState<Code>) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Loads the anonymous device choice. Call once at startup. */
  async init(): Promise<void> {
    // The device choice is independent of any account, so a context change
    // while reading does not make it stale.
    const stored = this.registry.normalize(await this.options.storage.get(ANONYMOUS_LANGUAGE_KEY));
    this.update({ anonymousChoice: stored });
  }

  /** Re-resolve after the device language may have changed (e.g. app foregrounded). */
  refreshDetection(): void {
    this.update({});
  }

  /**
   * Switches the language context. A member context shows the cached value
   * immediately (if any) and then reconciles with the server.
   */
  async setContext(context: LanguageContext): Promise<void> {
    if (sameContext(context, this.state.context)) return;
    this.epoch += 1;
    const epoch = this.epoch;

    if (context.kind === 'anonymous') {
      const wasMember = this.state.context.kind === 'member';
      this.update({ context, saved: null, savedKnown: false, personLinked: null, recipientHint: null, pending: undefined, status: 'idle', error: null });
      // Signing out clears every account's cached preference on this device.
      if (wasMember) await this.options.storage.remove(ACCOUNT_LANGUAGE_CACHE_KEY);
      return;
    }

    this.update({ context, saved: null, savedKnown: false, personLinked: null, recipientHint: null, pending: undefined, status: 'loading', error: null });
    const cache = parseCache(await this.options.storage.get(ACCOUNT_LANGUAGE_CACHE_KEY));
    if (epoch !== this.epoch) return;
    const key = cacheKey(context);
    if (Object.prototype.hasOwnProperty.call(cache, key)) {
      this.update({ saved: cache[key] ?? null, savedKnown: true });
    }
    await this.reconcile(epoch, context);
  }

  /** Re-reads the saved preference for the current church (bootstrap, refocus). */
  async refresh(): Promise<void> {
    const context = this.state.context;
    if (context.kind !== 'member' || this.state.pending !== undefined) return;
    await this.reconcile(this.epoch, context);
  }

  /**
   * A token page (respond link, invitation) verified its token and learned the
   * recipient's saved language. Display only: nothing is written anywhere.
   * Ignored for signed-in members, whose own preference applies.
   */
  setRecipientHint(value: string | null): void {
    if (this.state.context.kind !== 'anonymous') return;
    this.update({ recipientHint: value });
  }

  /** Signed-out choice on this device. Never written to any Person. */
  async setAnonymousChoice(value: Code | null): Promise<void> {
    if (value !== null && !this.registry.isSupported(value)) return;
    // A local toggle replaces a token page's recipient language.
    this.update({ anonymousChoice: value, recipientHint: null });
    if (value) await this.options.storage.set(ANONYMOUS_LANGUAGE_KEY, value);
    else await this.options.storage.remove(ANONYMOUS_LANGUAGE_KEY);
  }

  /**
   * Saves an explicit member choice (`null` = Automatic) for the current
   * church. Resolves once the server has persisted it — or failed, in which
   * case the previous language is restored.
   */
  async save(value: Code | null): Promise<SaveOutcome> {
    const context = this.state.context;
    if (context.kind !== 'member') return 'invalid';
    if (value !== null && !this.registry.isSupported(value)) return 'invalid';
    if (this.state.pending !== undefined) return 'busy';
    if (this.options.isOnline && !this.options.isOnline()) {
      this.update({ error: 'offline', status: 'error' });
      return 'offline';
    }
    const epoch = this.epoch;
    this.update({ pending: value, status: 'saving', error: null });
    try {
      const response = await this.options.api.save(context, value);
      if (epoch !== this.epoch) return 'stale';
      const saved = typeof response.preferred_language === 'string' ? response.preferred_language : null;
      this.update({ saved, savedKnown: true, personLinked: true, pending: undefined, status: 'idle', error: null });
      await this.writeCache(context, saved);
      return 'saved';
    } catch (error) {
      if (epoch !== this.epoch) return 'stale';
      const linkRequired = error instanceof ApiError && error.code === 'PERSON_LINK_REQUIRED';
      // fetch rejects with a TypeError when there is no connection at all.
      const offline = !(error instanceof ApiError) && error instanceof TypeError;
      const kind: LanguagePreferenceErrorKind = linkRequired ? 'link_required' : offline ? 'offline' : 'save_failed';
      this.update({
        pending: undefined,
        status: 'error',
        error: kind,
        ...(linkRequired ? { personLinked: false } : {}),
      });
      return linkRequired ? 'link_required' : offline ? 'offline' : 'failed';
    }
  }

  /** Clears a shown error without changing anything else. */
  dismissError(): void {
    if (this.state.error) this.update({ error: null, status: this.state.pending !== undefined ? 'saving' : 'idle' });
  }

  private async reconcile(epoch: number, context: MemberContext): Promise<void> {
    try {
      const response = await this.options.api.load(context);
      if (epoch !== this.epoch || this.state.pending !== undefined) return;
      const saved = typeof response.preferred_language === 'string' ? response.preferred_language : null;
      this.update({
        saved,
        savedKnown: true,
        personLinked: response.person_linked ?? true,
        status: 'idle',
        error: null,
      });
      await this.writeCache(context, saved);
    } catch {
      if (epoch !== this.epoch) return;
      // Offline or failing: keep showing the cached choice (if any).
      this.update({ status: this.state.savedKnown ? 'idle' : 'error', error: this.state.savedKnown ? null : 'load_failed' });
    }
  }

  private async writeCache(context: MemberContext, saved: string | null): Promise<void> {
    const cache = parseCache(await this.options.storage.get(ACCOUNT_LANGUAGE_CACHE_KEY));
    // The context may have ended while reading; never re-create a cleared cache.
    if (!sameContext(this.state.context, context)) return;
    cache[cacheKey(context)] = saved;
    await this.options.storage.set(ACCOUNT_LANGUAGE_CACHE_KEY, JSON.stringify(cache));
  }

  private resolve(state: Omit<LanguagePreferenceState<Code>, 'resolution'>): LocaleResolution<Code> {
    const member = state.context.kind === 'member';
    return resolveLocale(
      {
        member,
        saved: member ? (state.pending !== undefined ? state.pending : state.saved) : null,
        recipient: member ? null : state.recipientHint,
        anonymous: state.anonymousChoice,
        detected: this.options.detectLocales(),
      },
      this.registry,
    );
  }

  private update(patch: Partial<Omit<LanguagePreferenceState<Code>, 'resolution'>>): void {
    const { resolution: _previous, ...current } = this.state;
    const next = { ...current, ...patch };
    this.state = { ...next, resolution: this.resolve(next) };
    for (const listener of this.listeners) listener(this.state);
  }
}

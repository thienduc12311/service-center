import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api-client.js';
import {
  ACCOUNT_LANGUAGE_CACHE_KEY,
  ANONYMOUS_LANGUAGE_KEY,
  LanguagePreferenceController,
  selectedPreference,
  type LanguageContext,
  type LanguagePreferenceApi,
  type LanguageStorage,
} from './preference-controller.js';

type MemberContext = Extract<LanguageContext, { kind: 'member' }>;

const memoryStorage = (initial: Record<string, string> = {}): LanguageStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
    remove: (key) => {
      data.delete(key);
    },
  };
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** A fake server keyed by "profile:org"; each call can be held open to simulate latency. */
const fakeApi = (server: Record<string, string | null>, linked = true) => {
  const loads: Array<{ context: MemberContext; gate: Deferred<void> }> = [];
  const saves: Array<{ context: MemberContext; value: string | null }> = [];
  let failNextSave: unknown = null;
  let holdLoads = false;
  const api: LanguagePreferenceApi = {
    load: async (context) => {
      const gate = deferred<void>();
      loads.push({ context, gate });
      if (holdLoads) await gate.promise;
      return { preferred_language: server[`${context.profileId}:${context.organizationId}`] ?? null, person_linked: linked };
    },
    save: async (context, value) => {
      saves.push({ context, value });
      if (failNextSave) {
        const error = failNextSave;
        failNextSave = null;
        throw error;
      }
      server[`${context.profileId}:${context.organizationId}`] = value;
      return { preferred_language: value };
    },
  };
  return {
    api,
    loads,
    saves,
    failSave: (error: unknown) => {
      failNextSave = error;
    },
    hold: (value: boolean) => {
      holdLoads = value;
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const member = (profileId: string, organizationId: string): MemberContext => ({ kind: 'member', profileId, organizationId });

describe('LanguagePreferenceController', () => {
  it('shows the saved preference for the active church and caches it per profile and church', async () => {
    const storage = memoryStorage();
    const server = fakeApi({ 'p1:org-a': 'vi', 'p1:org-b': 'en' });
    const controller = new LanguagePreferenceController({ storage, api: server.api, detectLocales: () => ['en-US'] });
    await controller.setContext(member('p1', 'org-a'));
    expect(controller.getState().resolution).toMatchObject({ locale: 'vi', source: 'saved' });
    await controller.setContext(member('p1', 'org-b'));
    expect(controller.getState().resolution.locale).toBe('en');
    expect(JSON.parse(storage.data.get(ACCOUNT_LANGUAGE_CACHE_KEY) ?? '{}')).toEqual({ 'p1:org-a': 'vi', 'p1:org-b': 'en' });
  });

  it('uses the cached value at startup and while offline, then reconciles', async () => {
    const storage = memoryStorage({ [ACCOUNT_LANGUAGE_CACHE_KEY]: JSON.stringify({ 'p1:org-a': 'vi' }) });
    const server = fakeApi({ 'p1:org-a': 'en' });
    server.hold(true);
    const controller = new LanguagePreferenceController({ storage, api: server.api, detectLocales: () => [] });
    const pending = controller.setContext(member('p1', 'org-a'));
    await flush();
    expect(controller.getState().resolution.locale).toBe('vi');
    server.loads[0]?.gate.resolve();
    await pending;
    expect(controller.getState().resolution.locale).toBe('en');
  });

  it('ignores a late response from the previous church after a switch', async () => {
    const server = fakeApi({ 'p1:org-a': 'vi', 'p1:org-b': null });
    server.hold(true);
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => ['en'] });
    const first = controller.setContext(member('p1', 'org-a'));
    await flush();
    const second = controller.setContext(member('p1', 'org-b'));
    await flush();
    server.loads[1]?.gate.resolve();
    await second;
    server.loads[0]?.gate.resolve();
    await first;
    expect(controller.getState().context).toEqual(member('p1', 'org-b'));
    expect(controller.getState().resolution).toMatchObject({ locale: 'en', source: 'device' });
  });

  it("never selects another account's cached preference", async () => {
    const storage = memoryStorage({ [ACCOUNT_LANGUAGE_CACHE_KEY]: JSON.stringify({ 'p1:org-a': 'vi' }) });
    const server = fakeApi({});
    server.hold(true);
    const controller = new LanguagePreferenceController({ storage, api: server.api, detectLocales: () => ['en'] });
    void controller.setContext(member('p2', 'org-a'));
    await flush();
    expect(controller.getState().resolution.locale).toBe('en');
  });

  it('clears account caches on sign-out and keeps the anonymous device choice separate', async () => {
    const storage = memoryStorage({ [ANONYMOUS_LANGUAGE_KEY]: 'en' });
    const server = fakeApi({ 'p1:org-a': 'vi' });
    const controller = new LanguagePreferenceController({ storage, api: server.api, detectLocales: () => [] });
    await controller.init();
    await controller.setContext(member('p1', 'org-a'));
    expect(controller.getState().resolution.locale).toBe('vi');
    await controller.setContext({ kind: 'anonymous' });
    expect(storage.data.has(ACCOUNT_LANGUAGE_CACHE_KEY)).toBe(false);
    expect(storage.data.get(ANONYMOUS_LANGUAGE_KEY)).toBe('en');
    expect(controller.getState().resolution).toMatchObject({ locale: 'en', source: 'anonymous' });
  });

  it('switches immediately while saving, blocks duplicates, and confirms only after persistence', async () => {
    const server = fakeApi({ 'p1:org-a': null });
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => ['en'] });
    await controller.setContext(member('p1', 'org-a'));
    const saving = controller.save('vi');
    expect(controller.getState()).toMatchObject({ status: 'saving', pending: 'vi' });
    expect(controller.getState().resolution.locale).toBe('vi');
    expect(await controller.save('en')).toBe('busy');
    expect(await saving).toBe('saved');
    expect(controller.getState()).toMatchObject({ saved: 'vi', pending: undefined, status: 'idle' });
    expect(server.saves).toEqual([{ context: member('p1', 'org-a'), value: 'vi' }]);
  });

  it('restores the previous language when saving fails', async () => {
    const server = fakeApi({ 'p1:org-a': 'en' });
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => ['vi'] });
    await controller.setContext(member('p1', 'org-a'));
    server.failSave(new ApiError(500, 'boom'));
    expect(await controller.save('vi')).toBe('failed');
    expect(controller.getState()).toMatchObject({ saved: 'en', error: 'save_failed', status: 'error' });
    expect(controller.getState().resolution.locale).toBe('en');
    expect(selectedPreference(controller.getState())).toBe('en');
  });

  it('refuses to save offline without pretending success', async () => {
    const server = fakeApi({ 'p1:org-a': null });
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => [], isOnline: () => false });
    await controller.setContext(member('p1', 'org-a'));
    expect(await controller.save('vi')).toBe('offline');
    expect(server.saves).toHaveLength(0);
    expect(controller.getState()).toMatchObject({ saved: null, error: 'offline' });
  });

  it('treats a connection failure during save as offline and restores the choice', async () => {
    const server = fakeApi({ 'p1:org-a': 'en' });
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => [] });
    await controller.setContext(member('p1', 'org-a'));
    server.failSave(new TypeError('Network request failed'));
    expect(await controller.save('vi')).toBe('offline');
    expect(controller.getState()).toMatchObject({ saved: 'en', error: 'offline' });
    expect(controller.getState().resolution.locale).toBe('en');
  });

  it('reports a missing Person link as a recoverable state', async () => {
    const server = fakeApi({}, false);
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => [] });
    await controller.setContext(member('p1', 'org-a'));
    expect(controller.getState().personLinked).toBe(false);
    server.failSave(new ApiError(409, 'no link', 'PERSON_LINK_REQUIRED'));
    expect(await controller.save('vi')).toBe('link_required');
    expect(controller.getState().error).toBe('link_required');
  });

  it('never writes an automatically detected language as a preference', async () => {
    const server = fakeApi({ 'p1:org-a': null });
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => ['vi-VN'] });
    await controller.setContext(member('p1', 'org-a'));
    controller.refreshDetection();
    await controller.refresh();
    expect(controller.getState().resolution).toMatchObject({ locale: 'vi', source: 'device' });
    expect(controller.getState().saved).toBeNull();
    expect(server.saves).toHaveLength(0);
  });

  it('keeps an unsupported saved code from a newer client instead of overwriting it', async () => {
    const server = fakeApi({ 'p1:org-a': 'fr' });
    const controller = new LanguagePreferenceController({ storage: memoryStorage(), api: server.api, detectLocales: () => ['vi'] });
    await controller.setContext(member('p1', 'org-a'));
    expect(controller.getState().resolution).toMatchObject({ locale: 'en', unsupportedSaved: 'fr' });
    expect(selectedPreference(controller.getState())).toBe('fr');
    expect(server.saves).toHaveLength(0);
  });

  it('drops a save result that lands after sign-out', async () => {
    const storage = memoryStorage();
    const gate = deferred<{ preferred_language: string | null }>();
    const api: LanguagePreferenceApi = { load: async () => ({ preferred_language: null }), save: () => gate.promise };
    const controller = new LanguagePreferenceController({ storage, api, detectLocales: () => [] });
    await controller.setContext(member('p1', 'org-a'));
    const saving = controller.save('vi');
    await controller.setContext({ kind: 'anonymous' });
    gate.resolve({ preferred_language: 'vi' });
    expect(await saving).toBe('stale');
    expect(storage.data.has(ACCOUNT_LANGUAGE_CACHE_KEY)).toBe(false);
    expect(controller.getState().context.kind).toBe('anonymous');
  });

  it('uses a token recipient hint only while signed out, and a local toggle replaces it', async () => {
    const storage = memoryStorage();
    const controller = new LanguagePreferenceController({ storage, api: fakeApi({}).api, detectLocales: () => ['en'] });
    controller.setRecipientHint('vi');
    expect(controller.getState().resolution).toMatchObject({ locale: 'vi', source: 'recipient' });
    await controller.setAnonymousChoice('en');
    expect(controller.getState().resolution).toMatchObject({ locale: 'en', source: 'anonymous' });
    expect(controller.getState().recipientHint).toBeNull();
  });
});

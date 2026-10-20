import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

/**
 * Per-recipient language through the real dispatcher, with the database and
 * the email provider replaced by fakes. The captured delivery locale decides
 * the language — never the sender, and never a preference changed after the
 * delivery was queued.
 */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};

interface Filter {
  column: string;
  values: unknown[];
}

/** A minimal PostgREST-style builder over in-memory rows (eq/in filters only). */
class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Filter[] = [];
  constructor(private readonly table: string) {}
  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ column, values: [value] });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ column, values });
    return this;
  }
  private rows(): Row[] {
    return (tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter.values.includes(row[filter.column])));
  }
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows(), error: null as null }).then(onfulfilled, onrejected);
  }
}

const fakeAdminDb = {
  from: (table: string) => new FakeQuery(table),
  // The reminder is still current for every job in this test.
  rpc: () => Promise.resolve({ data: true, error: null }),
};

vi.mock('../lib/supabase.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase.js')>()),
  adminDb: fakeAdminDb,
}));

const { dispatchDelivery } = await import('./delivery-dispatch.js');
const { setNotificationTransport } = await import('./notifications.js');
const { serviceReminderEmail } = await import('./email/templates/service-reminder.js');
const { mapDeliveryRowToJob } = await import('../model/delivery.model.js');
type Notification = Parameters<typeof serviceReminderEmail>[0];

const seed = (): void => {
  tables.delivery_effects = [{
    id: 'effect-1', organization_id: 'org-1', template: 'service_reminder', plan_id: 'plan-1',
    assignment_ids: ['as-an', 'as-sam'], reminder_job_id: 'job-1', created_by: 'leader-1',
  }];
  // Both Persons' *current* preference is English: only the captured locale may choose Vietnamese.
  tables.people = [
    { id: 'person-an', organization_id: 'org-1', profile_id: null, archived_at: null, first_name: 'An', last_name: 'Nguyễn', email: 'an@example.test', preferred_language: 'en' },
    { id: 'person-sam', organization_id: 'org-1', profile_id: null, archived_at: null, first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test', preferred_language: 'en' },
  ];
  tables.assignments = [
    { id: 'as-an', plan_id: 'plan-1', person_id: 'person-an', status: 'confirmed', visibility: 'released', team: { name: 'Ban nhạc' }, position: { name: 'Keys' } },
    { id: 'as-sam', plan_id: 'plan-1', person_id: 'person-sam', status: 'confirmed', visibility: 'released', team: { name: 'Band' }, position: { name: 'Bass' } },
  ];
  tables.plans = [{ id: 'plan-1', organization_id: 'org-1', title: 'Sunday Worship', service_date: '2026-11-01', location: null }];
  tables.organizations = [{ id: 'org-1', name: 'Grace Church', timezone: 'America/Chicago' }];
  tables.reminder_jobs = [{ id: 'job-1', occurrence_starts_at: '2026-11-01T14:30:00Z', timezone: 'America/Chicago' }];
};

const job = (id: string, personId: string, locale: string | null) =>
  mapDeliveryRowToJob({
    id, organization_id: 'org-1', effect_id: 'effect-1', recipient_id: null, recipient_person_id: personId, channel: 'email',
    status: 'sending', attempts: 1, max_attempts: 5, next_attempt_at: '', lease_owner: 'worker', lease_expires_at: null,
    provider_call_started_at: null, provider_message_id: null, accepted_at: null, delivered_at: null, completed_at: null,
    last_error_code: null, manual_retries: 0, locale, created_at: '', updated_at: '',
  });

describe('per-recipient delivery language', () => {
  it('gives two simultaneous recipients their own language, and a retry the same text', async () => {
    seed();
    const sent: Notification[] = [];
    setNotificationTransport({
      mode: 'simulated',
      // A provider fake that answers out of order, like a real network.
      send: async (notification) => {
        await new Promise((resolve) => setTimeout(resolve, 'locale' in notification && notification.locale === 'vi' ? 5 : 0));
        sent.push(notification as Notification);
        return { providerMessageId: null };
      },
    });
    const begin = () => Promise.resolve(true);

    const results = await Promise.all([
      dispatchDelivery(job('d-an', 'person-an', 'vi'), begin),
      dispatchDelivery(job('d-sam', 'person-sam', 'en'), begin),
    ]);
    expect(results).toEqual([{ status: 'simulated' }, { status: 'simulated' }]);

    const byRecipient = new Map(sent.map((notification) => [notification.to, serviceReminderEmail(notification)]));
    const an = byRecipient.get('an@example.test');
    const sam = byRecipient.get('sam@example.test');
    expect(an?.subject).toBe('Sắp diễn ra: Sunday Worship');
    expect(an?.text).toContain('Chào An Nguyễn, xin nhắc bạn đã xác nhận phục vụ trong Sunday Worship.');
    expect(an?.text).toContain('Ban nhạc — Keys');
    expect(sam?.subject).toBe('Coming up: Sunday Worship');
    expect(sam?.text).toContain('Hi Sam Lee, this is a reminder');
    // The first time is shown in the organization's zone: 08:30 CST, after that morning's DST change.
    expect(sam?.text).toContain('Sun, Nov 1 · 8:30 AM');
    expect(an?.text).toMatch(/08:30|8:30/);

    // Retry of An's delivery after their preference changed: still Vietnamese.
    tables.people = (tables.people ?? []).map((person) => (person.id === 'person-an' ? { ...person, preferred_language: 'en' } : person));
    sent.length = 0;
    await dispatchDelivery(job('d-an', 'person-an', 'vi'), begin);
    expect(serviceReminderEmail(sent[0] as Notification)).toEqual(an);
  });

  it('renders a legacy delivery queued before i18n (no locale) in English', async () => {
    seed();
    const sent: Notification[] = [];
    setNotificationTransport({ mode: 'simulated', send: async (notification) => {
      sent.push(notification as Notification);
      return { providerMessageId: null };
    } });
    await dispatchDelivery(job('d-legacy', 'person-an', null), () => Promise.resolve(true));
    expect(sent[0]?.locale).toBe('en');
    expect(serviceReminderEmail(sent[0] as Notification).subject).toBe('Coming up: Sunday Worship');
  });
});

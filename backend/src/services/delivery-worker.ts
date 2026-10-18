import { randomUUID } from 'node:crypto';
import { adminDb, unwrap } from '../lib/supabase.js';
import {
  mapDeliveryRowToJob,
  type DeliveryJob,
  type DispatchResult,
  type WorkerRunOptions,
  type WorkerRunResult,
} from '../model/delivery.model.js';
import { dispatchDelivery, resultFromError } from './delivery-dispatch.js';

/** Longer than the slowest provider call (email gives up after 15s). */
export const DELIVERY_LEASE_SECONDS = 60;
/** How many deliveries one run works on at the same time. */
const CONCURRENCY = 4;

const complete = async (job: DeliveryJob, result: DispatchResult): Promise<boolean> => {
  const row = await unwrap(
    adminDb.rpc('complete_delivery', {
      p_delivery_id: job.id,
      p_worker: job.leaseOwner,
      p_status: result.status,
      p_error_code: result.errorCode ?? null,
      p_provider_message_id: result.providerMessageId ?? null,
      p_retry_after_seconds: result.retryAfterSeconds ?? null,
    }),
  );
  return row !== null;
};

/** Runs one leased delivery to a recorded outcome. */
const processJob = async (job: DeliveryJob, tally: WorkerRunResult): Promise<void> => {
  let providerCalled = false;
  const begin = async (): Promise<boolean> => {
    const started = await unwrap(
      adminDb.rpc('begin_delivery_provider_call', { p_delivery_id: job.id, p_worker: job.leaseOwner }),
    );
    providerCalled = started === true;
    return providerCalled;
  };

  let result: DispatchResult | null;
  try {
    result = await dispatchDelivery(job, begin);
  } catch (error) {
    result = resultFromError(error, job.attempts, providerCalled);
    if (result.errorCode === 'internal_error') {
      // Log the class only: messages from the database or a provider can
      // contain addresses.
      console.warn(`[deliveries] delivery ${job.id} hit an unexpected ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  if (result === null) {
    tally.abandoned += 1;
    return;
  }
  if (await complete(job, result)) {
    if (result.status === 'queued') tally.retried += 1;
    else tally.completed += 1;
  } else {
    tally.abandoned += 1;
  }
};

/**
 * One bounded worker run: execute due scheduled releases (F08), turn due
 * reminder jobs into outbox deliveries (F08), then claim due deliveries (SKIP LOCKED, with a lease),
 * deliver them, record each outcome. Safe to run from several places at
 * once — an HTTP request kicking its own effect, a scheduled job, a CLI —
 * because a delivery is only ever leased to one of them. A run that dies
 * part-way leaves leases that the next run recovers.
 */
export const runDeliveryWorker = async (options: WorkerRunOptions): Promise<WorkerRunResult> => {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const deadline = Date.now() + (options.timeBudgetMs ?? 25_000);
  const tally: WorkerRunResult = { claimed: 0, completed: 0, retried: 0, abandoned: 0, releases: 0, remindersEnqueued: 0 };

  // F08 due work comes first, so what it enqueues is claimed in this run.
  // Only general runs do it; an effect-scoped run delivers one action.
  if (!options.effectId) {
    const releases = await unwrap(adminDb.rpc('run_due_release_batches', { p_limit: 20 }));
    tally.releases = (releases ?? []).length;
    const reminders = await unwrap(adminDb.rpc('materialize_due_reminders', { p_limit: options.limit }));
    tally.remindersEnqueued = (reminders ?? []).filter((row) => row.outcome === 'enqueued').length;
  }

  const rows = await unwrap(
    adminDb.rpc('claim_deliveries', {
      p_worker: workerId,
      p_limit: options.limit,
      p_lease_seconds: DELIVERY_LEASE_SECONDS,
      p_effect_id: options.effectId ?? null,
    }),
  );
  const jobs = (rows ?? []).map(mapDeliveryRowToJob);
  tally.claimed = jobs.length;

  // In-app before push before email, so the feed row exists first.
  const order = { in_app: 0, push: 1, email: 2 } as const;
  const queue = [...jobs].sort((a, b) => order[a.channel] - order[b.channel]);

  const lane = async (): Promise<void> => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) {
        // Out of time: leave it leased; the lease expires before any provider
        // call, so the next run picks it up again.
        tally.abandoned += 1;
        continue;
      }
      await processJob(job, tally);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, lane));

  return tally;
};

/**
 * Delivers one action's deliveries right away, so the person who acted sees
 * outcomes in the response. Never throws: whatever is left stays queued for
 * the next worker run.
 */
export const deliverEffectNow = async (effectId: string | null): Promise<void> => {
  if (!effectId) return;
  try {
    await runDeliveryWorker({ limit: 100, effectId, timeBudgetMs: 20_000 });
  } catch (error) {
    console.warn(`[deliveries] immediate delivery of ${effectId} deferred to the worker (${error instanceof Error ? error.name : 'error'})`);
  }
};

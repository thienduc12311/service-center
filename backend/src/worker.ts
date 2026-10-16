/**
 * Delivery worker for long-lived deployments (Docker, a VM, local dev):
 *
 *   node backend/dist/worker.js            # one bounded run, then exit
 *   node backend/dist/worker.js --drain    # repeat until nothing is due (max 20 runs)
 *
 * Schedule it with whatever runs the container (cron, a Kubernetes CronJob,
 * a platform scheduler). Several copies may run at once: deliveries are
 * leased, never shared. The HTTP entry point `/api/v1/internal/deliveries/run`
 * does the same for serverless deployments.
 */
import { configureTransports } from './lib/transports.js';
import { runDeliveryWorker } from './services/delivery-worker.js';

const MAX_RUNS = 20;

const main = async (): Promise<void> => {
  configureTransports();
  const drain = process.argv.includes('--drain');
  for (let run = 1; run <= (drain ? MAX_RUNS : 1); run += 1) {
    const result = await runDeliveryWorker({ limit: 50, timeBudgetMs: 45_000 });
    console.info(
      `[worker] run ${run}: claimed ${result.claimed}, completed ${result.completed}, retry later ${result.retried}, abandoned ${result.abandoned}`,
    );
    if (result.claimed === 0) break;
  }
};

main().catch((error: unknown) => {
  console.error(`[worker] failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});

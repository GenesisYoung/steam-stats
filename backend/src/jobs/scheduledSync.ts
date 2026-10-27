/**
 * Standalone scheduled synchronization (Cloud Run Job / cron container).
 * Alternative to POST /internal/cron/sync for deployments where long-running
 * work should not happen inside the API service.
 *
 *   node dist/scheduledSync.js [maxUsers] [staleHours]
 */
import { loadEnv } from '../config/env';
import { initFirebase } from '../config/firebase';
import { createContainer } from '../container';
import { logger } from '../lib/logger';

const env = loadEnv();
const { db, auth } = initFirebase(env.FIREBASE_PROJECT_ID);
const container = createContainer({ env, db, auth });

const maxUsers = Number(process.argv[2] ?? 50);
const staleHours = Number(process.argv[3] ?? 12);

container.sync
  .runScheduled(maxUsers, staleHours * 60 * 60 * 1000)
  .then((result) => {
    logger.info('scheduled sync complete', result);
    process.exit(0);
  })
  .catch((err) => {
    logger.error('scheduled sync failed', { error: err });
    process.exit(1);
  });

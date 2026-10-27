import { loadEnv } from './config/env';
import { initFirebase } from './config/firebase';
import { createContainer } from './container';
import { createApp } from './app';
import { logger, setLogLevel } from './lib/logger';

const env = loadEnv();
setLogLevel(env.LOG_LEVEL);
const { db, auth } = initFirebase(env.FIREBASE_PROJECT_ID);
const container = createContainer({ env, db, auth });
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  logger.info('api listening', { port: env.PORT, env: env.NODE_ENV, emulators: Boolean(process.env.FIRESTORE_EMULATOR_HOST) });
});

async function shutdown(signal: string) {
  logger.info('shutting down', { signal });
  server.close();
  // Let in-flight sync jobs finish (Cloud Run grants ~10s after SIGTERM); stale locks expire otherwise.
  await Promise.race([container.sync.wait(), new Promise((r) => setTimeout(r, 8000))]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

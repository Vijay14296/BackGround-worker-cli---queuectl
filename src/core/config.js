import { getDB, initDB } from '../db/database.js';
import 'dotenv/config'; // auto-load .env

await initDB();

/**
 * Load environment defaults (from .env)
 */
const envDefaults = {
  workerCount: process.env.WORKER_COUNT ? Number(process.env.WORKER_COUNT) : 1,
  pollInterval: process.env.POLL_INTERVAL ? Number(process.env.POLL_INTERVAL) : 1500,
  jobTimeout: process.env.JOB_TIMEOUT ? Number(process.env.JOB_TIMEOUT) : 0,
  dbPath: process.env.DB_PATH || './db/db.json',
};

/**
 * Return the current config (merged: LowDB + .env defaults)
 */
export async function getConfig() {
  const db = getDB();
  await db.read();

  // Ensure config object exists
  db.data.config = db.data.config || {};

  // Merge .env defaults for missing keys
  const merged = { ...envDefaults, ...db.data.config };

  // If LowDB is missing any defaults, persist them
  const needsUpdate = Object.keys(envDefaults).some(
    (key) => db.data.config[key] === undefined
  );
  if (needsUpdate) {
    db.data.config = merged;
    await db.write();
  }

  console.log(' Current config:', merged);
  return merged;
}

/**
 * setConfig(keyOrObject, value?)
 * - If first arg is object, merges it into config.
 * - If first arg is string key and value provided, sets single key.
 */
export async function setConfig(keyOrObj, maybeValue) {
  const db = getDB();
  await db.read();

  db.data.config = db.data.config || {};

  if (typeof keyOrObj === 'object') {
    // Merge object into config
    db.data.config = { ...db.data.config, ...keyOrObj };
  } else {
    const key = String(keyOrObj);
    let value = maybeValue;

    // Auto-convert common data types
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(Number(value))) value = Number(value);

    db.data.config[key] = value;
  }

  await db.write();
  console.log('✅ Config updated:', db.data.config);
  return db.data.config;
}

export default { getConfig, setConfig };

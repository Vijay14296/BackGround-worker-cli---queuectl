import { getDB, initDB } from '../db/database.js';
import dotenv from 'dotenv'
dotenv.config();

await initDB();

const envDefaults = {
  workerCount: process.env.WORKER_COUNT ? Number(process.env.WORKER_COUNT) : 1,
  pollInterval: process.env.POLL_INTERVAL ? Number(process.env.POLL_INTERVAL) : 1500,
  jobTimeout: process.env.JOB_TIMEOUT ? Number(process.env.JOB_TIMEOUT) : 0,
  dbPath: process.env.QUEUECTL_DB_FILE || './data/db.json',
};


export async function getConfig() {
  const db = getDB();
  await db.read();

  
  db.data.config = db.data.config || {};

 
  const merged = { ...envDefaults, ...db.data.config };


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


export async function setConfig(keyOrObj, maybeValue) {
  const db = getDB();
  await db.read();

  db.data.config = db.data.config || {};

  if (typeof keyOrObj === 'object') {
    
    db.data.config = { ...db.data.config, ...keyOrObj };
  } else {
    const key = String(keyOrObj);
    let value = maybeValue;

   
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(Number(value))) value = Number(value);

    db.data.config[key] = value;
  }

  await db.write();
  console.log(' Config updated:', db.data.config);
  return db.data.config;
}

export default { getConfig, setConfig };

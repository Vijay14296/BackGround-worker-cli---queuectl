
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Mutex } from 'async-mutex';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.QUEUECTL_DB_FILE || path.join(__dirname, '../../data/db.json');

const adapter = new JSONFile(DB_FILE);
const db = new Low(adapter, { jobs: [], dlq: [], config: {} });

export const dbMutex = new Mutex();

export async function initDB() {

  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await db.read();
  db.data = db.data || { jobs: [], dlq: [], config: {} };
 
  db.data.config.maxRetries = db.data.config.maxRetries ?? process.env.maxRetries ?? 3;
  db.data.config.claimTimeout = db.data.config.claimTimeout ?? 300; 
  await db.write();
}

export function getDB() {
  return db;
}

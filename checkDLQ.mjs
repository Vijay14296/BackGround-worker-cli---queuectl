import { getDB, initDB } from './src/db/database.js';

await initDB();

const db = getDB();
await db.read();

console.log('Jobs:', db.data.jobs);
console.log('DLQ:', db.data.dlq);

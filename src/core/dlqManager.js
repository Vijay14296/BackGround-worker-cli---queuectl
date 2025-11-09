
import { getDB, initDB, dbMutex } from '../db/database.js';
await initDB();

function isoNow(){ return new Date().toISOString(); }

export async function listDLQJobs() {
  const db = getDB();
  await db.read();
  db.data.dlq = db.data.dlq || [];
  if (!db.data.dlq.length) console.log('(DLQ is empty)');
  else console.table(db.data.dlq.map(j => ({
    id: j.id, command: j.command, attempts: j.attempts, max_retries: j.max_retries, dead_at: j.dead_at ?? j.updated_at
  })));
  return db.data.dlq;
}

export async function retryDLQJob(jobId) {
  const db = getDB();
  return await dbMutex.runExclusive(async () => {
    await db.read();
    db.data.dlq = db.data.dlq || [];
    const idx = db.data.dlq.findIndex(j => j.id === jobId);
    if (idx === -1) { console.log(`(DLQ) Job not found: ${jobId}`); return null; }

    const [dlqJob] = db.data.dlq.splice(idx, 1);
    db.data.jobs = db.data.jobs || [];
    const requeued = {
      ...dlqJob,
      state: 'pending',
      attempts: 0,
      locked: false,
      locked_by: null,
      locked_at: null,
      updated_at: isoNow(),
    };
    db.data.jobs.push(requeued);
    await db.write();
    console.log(` DLQ job requeued: ${jobId}`);
    return requeued;
  });
}

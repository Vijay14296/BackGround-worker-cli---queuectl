import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { getDB, initDB, dbMutex } from '../db/database.js';

dotenv.config();
await initDB();

function isoNow() {
  return new Date().toISOString();
}


const MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10) || 3;
const CLAIM_TIMEOUT = parseInt(process.env.CLAIM_TIMEOUT, 10) || 300;

export async function listJobs(state) {
  try {
    const db = getDB();
    await db.read();

    let jobList = db.data.jobs || [];

    // Include DLQ jobs if asking for 'dead'
    if (state === 'dead') {
      jobList = db.data.dlq || [];
    } else if (state) {
      jobList = jobList.filter(job => job.state === state);
    }

    if (jobList.length === 0) {
      console.log(state ? `No jobs in state: ${state}` : 'No jobs found.');
      return [];
    }

    console.log(`\n Jobs${state ? ` (${state})` : ''}:`);
    jobList.forEach(job => {
      console.log(`- ID: ${job.id}, Command: ${job.command}, State: ${state === 'dead' ? 'dead' : job.state}`);
    });

    return jobList;
  } catch (err) {
    console.error('Error listing jobs:', err.message);
    return [];
  }
}

export async function enqueueJob(jobData) {
  if (!jobData?.command) throw new Error('enqueueJob requires jobData.command');
  const db = getDB();

  return await dbMutex.runExclusive(async () => {
    await db.read();

    const newJob = {
      id: jobData.id || uuidv4(),
      command: jobData.command,
      state: 'pending',
      attempts: 0,
      max_retries: jobData.max_retries ?? (db.data.config?.maxRetries ?? MAX_RETRIES),
      created_at: isoNow(),
      updated_at: isoNow(),
      next_run_at: null,
      locked: false,
      locked_by: null,
      locked_at: null,
      output: null,
    };

    db.data.jobs = db.data.jobs || [];
    db.data.jobs.push(newJob);
    await db.write();
    console.log(` Job enqueued: ${newJob.id}`);
    return newJob;
  });
}

export async function getStatus() {
  const db = getDB();
  await db.read();

  const jobs = db.data.jobs || [];
  const dlq = db.data.dlq || [];

  const total = jobs.length + dlq.length; // all jobs including DLQ
  const pending = jobs.filter(j => j.state === 'pending').length;
  const processing = jobs.filter(j => j.state === 'processing').length;
  const completed = jobs.filter(j => j.state === 'completed').length;
  const failed = jobs.filter(j => j.state === 'failed').length;
  const dead = dlq.length; // DLQ jobs are "dead"

  console.log(' Queue Status:');
  console.log(`Total Jobs: ${total}`);
  console.log(`Pending: ${pending}`);
  console.log(`Processing: ${processing}`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Dead: ${dead}`);
}


export async function fetchAndLockJob(workerId, claimTimeoutSeconds = null) {
  const db = getDB();
  return await dbMutex.runExclusive(async () => {
    await db.read();
    db.data.jobs = db.data.jobs || [];
    const now = Date.now();
    const claimTimeout = claimTimeoutSeconds ?? (db.data.config?.claimTimeout ?? CLAIM_TIMEOUT);

    let job = db.data.jobs.find(j => j.state === 'pending' && !j.locked);
    if (!job) {
      job = db.data.jobs.find(j => j.state === 'processing' && j.locked_at &&
        ((now - new Date(j.locked_at).getTime()) / 1000) > claimTimeout);
    }

    if (!job) return null;

    job.state = 'processing';
    job.locked = true;
    job.locked_by = workerId;
    job.locked_at = isoNow();
    job.updated_at = isoNow();
    await db.write();
    return job;
  });
}

export async function completeJob(jobId, output = '') {
  const db = getDB();
  await dbMutex.runExclusive(async () => {
    await db.read();
    const job = db.data.jobs.find(j => j.id === jobId);
    if (!job) return null;
    job.state = 'completed';
    job.locked = false;
    job.locked_by = null;
    job.locked_at = null;
    job.output = output;
    job.updated_at = isoNow();
    await db.write();
  });
}

export async function failJob(jobId, output = '') {
  const db = getDB();
  await dbMutex.runExclusive(async () => {
    await db.read();
    const job = db.data.jobs.find(j => j.id === jobId);
    if (!job) return null;

    job.attempts = (job.attempts ?? 0) + 1;
    job.output = output;
    job.updated_at = isoNow();

    const maxRetries = job.max_retries ?? (db.data.config?.maxRetries ?? MAX_RETRIES);

    if (job.attempts >= maxRetries) {
        // Remove the job from jobs array
        const idx = db.data.jobs.findIndex(j => j.id === job.id);
        if (idx !== -1) db.data.jobs.splice(idx, 1);

        job.state = 'dead';
        job.locked = false;
        job.locked_by = null;
        job.locked_at = null;

        db.data.dlq = db.data.dlq || [];
        db.data.dlq.push({ ...job, dead_at: isoNow() });

        console.log(` Job moved to DLQ: ${job.id}`);
      } else {
        job.state = 'pending';
        job.locked = false;
        job.locked_by = null;
        job.locked_at = null;
      }
      await db.write();

  });
}

export async function resetJobForRetry(jobId) {
  const db = getDB();
  await dbMutex.runExclusive(async () => {
    await db.read();
    const job = db.data.jobs.find(j => j.id === jobId);
    if (!job) return null;
    job.state = 'pending';
    job.locked = false;
    job.locked_by = null;
    job.locked_at = null;
    job.updated_at = isoNow();
    await db.write();
    console.log(` Job reset for retry: ${jobId}`);
  });
}

export async function unlockStaleJobs(timeoutSeconds = null) {
  const db = getDB();
  const now = Date.now();
  return await dbMutex.runExclusive(async () => {
    await db.read();
    const timeout = timeoutSeconds ?? (db.data.config?.claimTimeout ?? CLAIM_TIMEOUT);
    let unlockedCount = 0;
    db.data.jobs = db.data.jobs || [];
    for (let job of db.data.jobs) {
      if ((job.state === 'processing' || job.locked) && job.locked_at) {
        const age = (now - new Date(job.locked_at).getTime()) / 1000;
        if (age > timeout) {
          job.state = 'pending';
          job.locked = false;
          job.locked_by = null;
          job.locked_at = null;
          unlockedCount++;
        }
      }
    }
    await db.write();
    console.log(` Unlocked ${unlockedCount} stale job(s).`);
  });
}

export async function clearAllJobs() {
  const db = getDB();
  await dbMutex.runExclusive(async () => {
    db.data.jobs = [];
    db.data.dlq = [];
    await db.write();
  });
}

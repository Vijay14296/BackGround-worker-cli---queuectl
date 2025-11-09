#!/usr/bin/env node
import { spawn } from 'child_process';

import { fetchAndLockJob, completeJob, failJob, resetJobForRetry } from './jobManager.js';
import { getDB, initDB } from '../db/database.js';



await initDB();

let isRunning = false;
let workerPromises = [];

export async function startWorkers(count = 1, pollInterval = 1500, jobTimeout = 0) {
  // 🧩 Step 1: Override defaults with environment variables if available
  const resolvedCount = process.env.WORKER_COUNT
    ? Number(process.env.WORKER_COUNT)
    : count;

  const resolvedPollInterval = process.env.QUEUE_POLL_INTERVAL
    ? Number(process.env.QUEUE_POLL_INTERVAL)
    : pollInterval;

  const resolvedJobTimeout = process.env.JOB_TIMEOUT
    ? Number(process.env.JOB_TIMEOUT)
    : jobTimeout;

  if (isRunning) {
    console.log(' Workers already running');
    return;
  }

  isRunning = true;

  // 🧩 Step 2: Show configuration for clarity
  console.log(
    ` Starting ${resolvedCount} worker(s)... (pollInterval=${resolvedPollInterval}ms, jobTimeout=${resolvedJobTimeout}s)`
  );

  // 🧩 Step 3: Reset stuck jobs before starting
  await resetStuckJobs();

  // 🧩 Step 4: Start worker loops
  for (let i = 0; i < resolvedCount; i++) {
    const workerId = `worker-${i + 1}`;
    const workerPromise = runWorkerLoop(workerId, resolvedPollInterval, resolvedJobTimeout);
    workerPromises.push(workerPromise);
  }

  // 🧩 Step 5: Graceful shutdown
  process.once('SIGINT', stopWorkers);
  process.once('SIGTERM', stopWorkers);
}

async function resetStuckJobs() {
  const { getDB } = await import('../db/database.js');
  const db = getDB();
  await db.read();

  for (let job of db.data.jobs || []) {
    if (job.state === 'processing') {
      await resetJobForRetry(job.id);
    }
  }
}

async function runWorkerLoop(workerId, pollInterval, jobTimeout) {
  console.log(` Worker started: ${workerId}`);

  while (isRunning) {
    try {
      const job = await fetchAndLockJob(workerId);

      if (!job) {
        await sleep(pollInterval);
        continue;
      }

      console.log(` [${workerId}] Executing job ${job.id}: ${job.command}`);
      await executeJob(job, workerId, jobTimeout);
    } catch (err) {
      console.error(` [${workerId}] error:`, err?.message ?? err);
      await sleep(2000);
    }
  }

  console.log(` Worker stopped: ${workerId}`);
}

async function executeJob(job, workerId, jobTimeout = 0) {
  return new Promise((resolve) => {
    const startTs = Date.now();
    const child = spawn(job.command, { shell: true });
    let output = '';
    let finished = false;

    const timer = jobTimeout > 0 ? setTimeout(async () => {
      if (!finished) {
        finished = true;
        child.kill('SIGTERM');
        output += `\n Job timed out after ${jobTimeout}ms`;
        console.log(` [${workerId}] Job ${job.id} timed out`);
        await failJob(job.id, output);
        resolve();
      }
    }, jobTimeout) : null;

    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });

    child.on('error', async (err) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      output += `\nspawn error: ${err.message}`;
      console.log(` [${workerId}] spawn error for job ${job.id}: ${err.message}`);
      await failJob(job.id, output);
      resolve();
    });

    child.on('close', async (code) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      const duration = ((Date.now() - startTs) / 1000).toFixed(2);

      if (code === 0) {
        console.log(` [${workerId}] Job ${job.id} completed (${duration}s)`);
        await completeJob(job.id, output);
      } else {
        console.log(` [${workerId}] Job ${job.id} failed (exit ${code})`);
        await failJob(job.id, output || `Exit code ${code}`);
      }
      resolve();
    });
  });
}

export async function stopWorkers() {
  if (!isRunning) {
    console.log(' Workers are not running');
    return;
  }

  console.log(' Stopping workers... waiting for active jobs to finish');
  isRunning = false;

  try {
    await Promise.all(workerPromises);
  } catch (err) {
    console.error(' Error stopping workers:', err);
  } finally {
    workerPromises = [];
    console.log(' All workers stopped');
    process.exit(0);
  }
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

export default { startWorkers, stopWorkers };

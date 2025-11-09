#!/usr/bin/env node
import { getDB } from './src/db/database.js';

const jobId = 'job1'; // job to delete

async function deleteJob(id) {
    const db = getDB();
    await db.read();
    const jobsBefore = db.data.jobs.length;
    db.data.jobs = db.data.jobs.filter(j => j.id !== id);
    const jobsAfter = db.data.jobs.length;
    await db.write();
    console.log(`✅ Deleted job '${id}'. Total jobs before: ${jobsBefore}, after: ${jobsAfter}`);
}

deleteJob(jobId).catch(err => console.error(err));

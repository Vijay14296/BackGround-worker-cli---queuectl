#!/usr/bin/env node
import {enqueueJob} from '../core/jobManager.js';
import {startWorkers,stopWorkers} from '../core/workerManager.js';
import {getStatus} from '../core/jobManager.js';
import {listDLQJobs,retryDLQJob} from '../core/dlqManager.js';
import { resetJobForRetry, listJobs,unlockStaleJobs,clearAllJobs } from '../core/jobManager.js';
import {setConfig,getConfig} from '../core/config.js';
import {Command} from 'commander';

const program = new Command();

program
    .name('queuectl')
    .description('CLI Based background job queue')
    .version('1.1.1');

program
    .command('enqueue')
    .description('enqueue jobs')
    .argument('<jobJson...>', 'Job data as JSON')
    .action(async (jobJsonParts) => {
    try {
        const jobJson = jobJsonParts.join(' ');
        const jobData = JSON.parse(jobJson);
        await enqueueJob(jobData);
    } catch (err) {
        console.error('Invalid Job:', err.message);
    }
    });


program
    .command('worker')
    .description('Start or Stop workers')
    .option('--start','Start workers')
    .option('--stop','Stop workers')
    .option('--count <number>','Number of workers','1')
    .action(async (options)=>{
        if(options.start){
            await startWorkers(parseInt(options.count));
        }
        else if(options.stop){
            await stopWorkers();
        }
        else{
            console.log('Specify --start or --stop');
        }
    });

program
    .command('status')
    .description('show worker and queue summary')
    .action(async ()=>{
        await getStatus();
    });
program
  .command('reset-stale')
  .description('Reset all stuck processing jobs')
  .option('--timeout <seconds>', 'Timeout to consider a job stale', '300')
  .action(async (options) => {
    const timeout = parseInt(options.timeout);
   
    await unlockStaleJobs(timeout);
  });
program
  .command('clear')
  .description('Clear all jobs from the queue')
  .action(async () => {
    await clearAllJobs(); 
    console.log('🧹 All jobs cleared.');
  });

program
    .command('list')
    .description('List jobs by state')
    .option('--state <state>','Filtered jobs by state')
    .action(async (options) => {
        await listJobs(options.state);
    });

const dlq = program.command('dlq').description('Dead letter queue operations');
dlq
    .command('retry <jobId>')
    .description('Retry a job from DLQ')
    .action(async (jobId) =>{
        await retryDLQJob(jobId);
    });
dlq
    .command('list')
    .description('List jobs in Dead Letter Queue')
    .action(async () => {
        await listDLQJobs();
    });

const config = program.command('config').description('Manage configuration');

config
    .command('get')
    .description('show current configuration')
    .action(async ()=>{
        await getConfig();
    });
config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key,value)=>{
        await setConfig(key,value);
    });



program
  .command('reset')
  .description('Reset jobs stuck in processing or by job ID')
  .argument('[jobId]', 'Job ID to reset (optional)')
  .option('--processing', 'Reset all jobs currently processing')
  .action(async (jobId, options) => {
    try {
      if (options.processing) {
        const processingJobs = await listJobs('processing');
        if (processingJobs.length === 0) {
          console.log('No jobs are currently processing.');
          return;
        }
        for (let job of processingJobs) {
          await resetJobForRetry(job.id);
        }
        console.log(`↪️ Reset ${processingJobs.length} processing job(s).`);
      } else if (jobId) {
        await resetJobForRetry(jobId);
      } else {
        console.log('Specify a job ID or use --processing to reset all processing jobs.');
      }
    } catch (err) {
      console.error('Error resetting job(s):', err.message);
    }
  });

program.parse(process.argv)

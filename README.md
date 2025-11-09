

# QueueCTL

QueueCTL is a CLI-based background job queue system built with Node.js. It manages background jobs with worker processes, supports retries with exponential backoff, and maintains a Dead Letter Queue (DLQ) for permanently failed jobs.

---

## 1. Setup Instructions

### Prerequisites
- Node.js 18 or higher
- PowerShell or any terminal with Node support

### Installation
```bash
git clone https://github.com/Vijay14296/BackGround-worker-cli---queuectl

npm install
````

### Run CLI Commands

All commands are executed using Node:

```bash
node src/cli/index.js <command>
```

Example:

```bash
node src/cli/index.js enqueue "{\"id\":\"job1\",\"command\":\"echo Hello World\"}"
```

### Optional Configuration

Set polling interval using an environment variable:

```powershell
$env:QUEUE_POLL_INTERVAL = 5000
```

---

## 2. Usage Examples

### Enqueue a Job

```bash
node src/cli/index.js enqueue "{\"id\":\"job1\",\"command\":\"echo Hello World\"}"
```

### Start Worker

```bash
node src/cli/index.js worker --start --count 2
```

### List Jobs by State

```bash
node src/cli/index.js list --state completed
```

### View Dead Letter Queue

```bash
node src/cli/index.js dlq list
```

### Clear All Jobs

```bash
node src/cli/index.js clear
```

---

## 3. Architecture Overview

### Job Lifecycle

Each job passes through the following states:

* **pending**: Waiting to be picked up by a worker
* **processing**: Currently being executed
* **completed**: Successfully executed
* **failed**: Failed but retryable
* **dead**: Permanently failed (moved to DLQ)

### Data Persistence

QueueCTL uses `lowdb` for file-based JSON storage located under `./data/db.json`.
All job data, configuration, and DLQ entries are persisted across restarts.

### Worker Logic

* Workers continuously poll for pending jobs.
* Each job is locked during processing to prevent duplicate execution.
* If a job fails, it is retried using exponential backoff:
  `delay = base ^ attempts` seconds.
* After reaching the maximum retries, the job is moved to the DLQ.
* Workers support graceful shutdown and parallel processing.

---

## 4. Assumptions & Trade-offs

* **Storage Choice**: Used `lowdb` for simplicity and local persistence instead of MongoDB or SQLite.
* **Simplification**: CLI-only implementation, no REST API or distributed coordination.
* **Retry Policy**: Default maximum retries = 3 with exponential backoff.
* **Job Timeout**: Basic timeout handling, can be extended.
* **Concurrency**: Multiple workers supported on a single machine; distributed scaling not implemented.

---

## 5. Testing Instructions

An automated PowerShell script `run_tests.ps1` is included to validate core functionality.

Run all tests:

```powershell
.\run_tests.ps1
```

This script verifies:

1. Basic job completes successfully.
2. Failed job retries and moves to DLQ.
3. Multiple workers process jobs without overlap.
4. Invalid commands fail gracefully.
5. Job data persists across restarts.

---


---





---

# DESIGN.md

## 1. System Overview

**QueueCTL** is a lightweight, file-based background job queue and worker system built entirely in **Node.js**.
It provides a CLI interface for enqueuing, processing, and managing asynchronous jobs without any external dependencies such as Redis or message brokers.

The system allows jobs to be executed by worker processes, supports retries with failure handling, manages a Dead Letter Queue (DLQ) for failed jobs, and ensures persistence across restarts using **LowDB** as the data store.

---

## 2. High-Level Architecture

```
 ┌──────────────────────────┐
 │        CLI Layer         │
 │ (Commander.js Interface) │
 └────────────┬─────────────┘
              │
              ▼
 ┌──────────────────────────┐
 │     Core Logic Layer     │
 │ jobManager.js            │
 │ workerManager.js         │
 │ dlqManager.js            │
 │ config.js                │
 └────────────┬─────────────┘
              │
              ▼
 ┌──────────────────────────┐
 │     Persistence Layer    │
 │ database.js (LowDB)      │
 │ data/db.json             │
 └──────────────────────────┘
```

### Components:

* **CLI Layer**: Handles all command parsing and dispatch using Commander.js.
* **Core Logic Layer**: Manages queue operations, workers, job execution, retries, and configuration.
* **Persistence Layer**: Uses LowDB with JSONFile adapter for durable storage.

---

## 3. Key Design Decisions

| Decision                    | Rationale                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| **LowDB for persistence**   | Provides a simple, file-based database suitable for small-scale use and easy inspection of state. |
| **Single-process workers**  | Simplifies synchronization and avoids the complexity of inter-process communication.              |
| **Job locking via flags**   | Prevents duplicate processing of jobs across multiple workers.                                    |
| **Retry and DLQ mechanism** | Ensures fault-tolerance and visibility into failed jobs.                                          |
| **Async-mutex usage**       | Provides mutual exclusion for concurrent DB access to ensure data consistency.                    |
| **Environment + DB config** | Allows runtime flexibility with persisted overrides.                                              |

---

## 4. Job Lifecycle

Each job transitions through distinct states managed by `jobManager.js`.

| State          | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| **pending**    | Job waiting to be processed by a worker.                    |
| **processing** | Job currently being executed.                               |
| **completed**  | Job executed successfully with exit code 0.                 |
| **failed**     | Job execution failed but has remaining retry attempts.      |
| **dead**       | Job moved to Dead Letter Queue after exceeding max retries. |

### Transition Flow

```
enqueueJob() → pending
fetchAndLockJob() → processing
completeJob() → completed
failJob() → failed → pending (if attempts < maxRetries)
failJob() → dead (if attempts ≥ maxRetries)
DLQ retry → pending
```

---

## 5. Worker Architecture

### Worker Lifecycle

Each worker runs an asynchronous polling loop that continuously:

1. Fetches a pending or stale job using `fetchAndLockJob(workerId)`
2. Executes the command via `child_process.spawn()`
3. Marks the job as **completed** or **failed**
4. Sleeps for a configured poll interval before repeating

Workers are started or stopped via:

```bash
queuectl worker --start --count 2
queuectl worker --stop
```

### Concurrency and Safety

* Multiple workers can run concurrently in the same process.
* Mutex locking ensures exclusive write access to the database.
* Each job includes:

  * `locked`: boolean flag
  * `locked_by`: worker ID
  * `locked_at`: ISO timestamp

### Timeout Handling

* A `jobTimeout` value (from config or env) terminates long-running jobs.
* If a job exceeds the timeout, it is killed, marked failed, and retried if allowed.

---

## 6. Data Persistence

### Database

* Managed via **LowDB** with `JSONFile` adapter.
* Stored at `data/db.json` (default).
* Automatically created if missing.

### Schema

```json
{
  "jobs": [
    {
      "id": "uuid",
      "command": "echo Hello",
      "state": "pending",
      "attempts": 0,
      "max_retries": 3,
      "locked": false,
      "locked_by": null,
      "locked_at": null,
      "output": "",
      "created_at": "ISODate",
      "updated_at": "ISODate"
    }
  ],
  "dlq": [],
  "config": {
    "maxRetries": 3,
    "claimTimeout": 300
  }
}
```

### Concurrency Safety

* All database writes are performed inside an `async-mutex` critical section.
* Prevents race conditions when multiple workers modify the same job records.

---

## 7. Configuration Management

Configuration values are loaded from two sources:

1. **Environment Variables** (`.env` file)
2. **LowDB Configuration Object**

When the system starts:

* `.env` defaults are loaded first.
* Missing keys are persisted into LowDB automatically.
* CLI provides commands to modify or inspect configuration.

Example:

```bash
queuectl config get
queuectl config set workerCount 3
```

---

## 8. Error Handling and Recovery

### Invalid Job Handling

* Jobs without valid JSON or missing `command` field fail gracefully.
* CLI outputs error message without breaking process flow.

### Retry and Backoff

* When a job fails, it increments `attempts` and requeues if under retry limit.
* Exceeding the retry limit moves the job to DLQ.
* DLQ jobs can be retried manually.

### Stale Job Detection

* Jobs locked for longer than `claimTimeout` are reset using:

  ```bash
  queuectl reset-stale --timeout 300
  ```

### Crash Recovery

* Jobs persist in `data/db.json`.
* On restart, workers resume processing pending jobs.
* Processing jobs are reset to pending at worker startup.

---

## 9. Dead Letter Queue (DLQ)

DLQ stores permanently failed jobs for manual inspection or reprocessing.

| Action                       | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `queuectl dlq list`          | Lists all DLQ jobs.                         |
| `queuectl dlq retry <jobId>` | Moves a failed job back into pending queue. |

Each DLQ job retains its metadata including failure logs and timestamps.

---

## 10. CLI Structure

The system uses **Commander.js** to expose modular commands.

| Command       | Purpose                                  |
| ------------- | ---------------------------------------- |
| `enqueue`     | Add new jobs                             |
| `worker`      | Start or stop workers                    |
| `status`      | Display summary of queue states          |
| `list`        | List jobs by state                       |
| `reset`       | Reset a job by ID or all processing jobs |
| `reset-stale` | Unlock stale jobs                        |
| `clear`       | Wipe all job and DLQ data                |
| `dlq`         | List or retry DLQ jobs                   |
| `config`      | Manage configuration                     |

---

## 11. Design Trade-offs and Limitations

| Aspect                          | Trade-off                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| **LowDB-based persistence**     | Simple and portable but not suitable for high-scale concurrent writes.                       |
| **In-memory workers**           | Easy to manage but not distributed. Only one process can operate safely on a single DB file. |
| **No exponential backoff**      | Simplifies retry logic at cost of uniform retry delay.                                       |
| **Single-machine architecture** | Designed for local environments and testing, not clustered workloads.                        |

---

## 12. Possible Improvements

1. Replace LowDB with Redis or MongoDB for scalability.
2. Introduce exponential backoff for retries.
3. Implement worker pooling via multiple Node.js processes.
4. Add web dashboard using Express and Socket.io for monitoring.
5. Enhance job scheduling (e.g., delayed or recurring jobs).
6. Add structured logs and metrics.

---

## 13. Summary

QueueCTL demonstrates a functional job queue system built with simplicity and robustness in mind.
Its modular structure separates CLI, core logic, and persistence layers, making it easy to extend into a distributed system in future iterations.

---


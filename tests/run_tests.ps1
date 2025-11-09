Write-Host "Running QueueCTL Automated Tests..." -ForegroundColor Cyan

if (Test-Path "./data/jobs.json") { Remove-Item "./data/jobs.json" }
if (Test-Path "./data/dlq.json") { Remove-Item "./data/dlq.json" }

Write-Host "`nEnqueueing job1..."
node src/cli/index.js enqueue '{\"id\":\"job1\",\"command\":\"echo Hello from job1\"}'

Write-Host "`nEnqueueing job-fail..."
node src/cli/index.js enqueue '{\"id\":\"job-fail\",\"command\":\"exit 1\"}'

Write-Host "`nStarting 1 worker..."
node src/cli/index.js worker --start --count 1

Start-Sleep -Seconds 5

Write-Host "`nCompleted Jobs:"
node src/cli/index.js list --state completed

Write-Host "`nDLQ Jobs:"
node src/cli/index.js dlq list

Write-Host "`nSimulating restart..."
node src/cli/index.js enqueue '{\"id\":\"job2\",\"command\":\"echo Survived restart\"}'
Start-Sleep -Seconds 1
Write-Host "Restarting worker..."
node src/cli/index.js worker --start --count 1

Start-Sleep -Seconds 3
Write-Host "`nFinal job summary:"
node src/cli/index.js list --state completed
node src/cli/index.js dlq list

Write-Host "`nAll tests executed." -ForegroundColor Green

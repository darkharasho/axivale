import { parentPort, workerData } from 'node:worker_threads'
import { runSummaryJobs, type SummaryJob } from './axibridgeSummarize'

const { jobs } = workerData as { jobs: SummaryJob[] }
parentPort!.postMessage(runSummaryJobs(jobs))

export type JobType = "search" | "profile" | "company" | "maps";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  params: unknown;
  progress: { current: number; total: number; page: number };
  message: string;
  results: unknown[];
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

const jobs = new Map<string, Job>();
const MAX_JOBS = 200;

export function createJob(type: JobType, params: unknown): Job {
  if (jobs.size >= MAX_JOBS) {
    const oldestFinished = [...jobs.values()]
      .filter((j) => j.status === "done" || j.status === "error" || j.status === "cancelled")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldestFinished) jobs.delete(oldestFinished.id);
  }
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: "queued",
    params,
    progress: { current: 0, total: 0, page: 0 },
    message: "Queued",
    results: [],
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function updateJob(id: string, patch: Partial<Job>) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}

export function pushResult(id: string, item: unknown) {
  const job = jobs.get(id);
  if (!job) return;
  job.results.push(item);
}

export function pushResults(id: string, items: unknown[]) {
  const job = jobs.get(id);
  if (!job) return;
  job.results.push(...items);
}

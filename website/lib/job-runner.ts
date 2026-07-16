import { LinkedInCookie, ProxyConfig } from "./linkedin-scraper";
import { MapsScrapeOptions, scrapeGoogleMaps } from "./maps-scraper";
import { scanProfiles } from "./profile-scanner";
import { scanCompanies } from "./company-scanner";
import { scrapeSalesNavSearch } from "./salesnav-scraper";
import { acquireScrapeJob, safeError } from "./api-security";
import { Job, JobType, createJob, getJob, pushResult, pushResults, updateJob } from "./job-store";

export interface SearchJobParams {
  searchUrl: string; cookies: LinkedInCookie[]; maxResults: number; mode: "leads" | "companies"; proxy?: ProxyConfig;
}
export interface ProfileJobParams {
  urls: string[]; cookies: LinkedInCookie[]; minConnections: number; minActivityMonths: number; proxy?: ProxyConfig;
}
export interface CompanyJobParams {
  urls: string[]; cookies: LinkedInCookie[]; proxy?: ProxyConfig;
}
export interface MapsJobParams {
  queries: string[]; maxResults: number; options: MapsScrapeOptions;
}

const queue: string[] = [];
let loopStarted = false;

export function enqueue(jobId: string) {
  queue.push(jobId);
  startLoop();
}

export function submitJob(type: JobType, params: unknown): Job {
  const job = createJob(type, params);
  enqueue(job.id);
  return job;
}

function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  runLoop();
}

async function runLoop() {
  for (;;) {
    const jobId = queue.shift();
    if (!jobId) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    const job = getJob(jobId);
    if (!job || job.status === "cancelled") continue;

    let release: (() => void) | undefined;
    try {
      release = acquireScrapeJob();
    } catch {
      // Should not happen — this loop is the only caller — but fail the job cleanly if it ever does.
      updateJob(jobId, { status: "error", error: "Server busy", finishedAt: Date.now() });
      continue;
    }

    updateJob(jobId, { status: "running", startedAt: Date.now(), message: "Starting..." });
    try {
      await runJob(job);
      if (getJob(jobId)?.status === "running") {
        updateJob(jobId, { status: "done", finishedAt: Date.now(), message: "Done" });
      }
    } catch (error) {
      updateJob(jobId, { status: "error", error: safeError(error), finishedAt: Date.now() });
    } finally {
      release?.();
    }
  }
}

function isCancelled(jobId: string) {
  return getJob(jobId)?.status === "cancelled";
}

async function runJob(job: Job) {
  switch (job.type) {
    case "search": {
      const p = job.params as SearchJobParams;
      for await (const progress of scrapeSalesNavSearch(p.searchUrl, p.cookies, p.maxResults, p.mode, p.proxy)) {
        if (isCancelled(job.id)) return;
        if (progress.type === "error") { updateJob(job.id, { status: "error", error: progress.message, finishedAt: Date.now() }); return; }
        updateJob(job.id, { progress: { current: progress.current, total: progress.total, page: progress.page || 0 }, message: progress.message });
        if (progress.type === "page_done" && progress.data) pushResults(job.id, progress.data);
      }
      return;
    }
    case "profile": {
      const p = job.params as ProfileJobParams;
      for await (const progress of scanProfiles(p.urls, p.cookies, { minConnections: p.minConnections, minActivityMonths: p.minActivityMonths, proxy: p.proxy })) {
        if (isCancelled(job.id)) return;
        if (progress.type === "error") { updateJob(job.id, { status: "error", error: progress.message, finishedAt: Date.now() }); return; }
        updateJob(job.id, { progress: { current: progress.current, total: progress.total, page: 0 }, message: progress.message });
        if (progress.type === "result" && progress.data) pushResult(job.id, progress.data);
      }
      return;
    }
    case "company": {
      const p = job.params as CompanyJobParams;
      for await (const progress of scanCompanies(p.urls, p.cookies, { proxy: p.proxy })) {
        if (isCancelled(job.id)) return;
        if (progress.type === "error") { updateJob(job.id, { status: "error", error: progress.message, finishedAt: Date.now() }); return; }
        updateJob(job.id, { progress: { current: progress.current, total: progress.total, page: 0 }, message: progress.message });
        if (progress.type === "result" && progress.data) pushResult(job.id, progress.data);
      }
      return;
    }
    case "maps": {
      const p = job.params as MapsJobParams;
      let totalScraped = 0;
      const grandTotal = p.maxResults * p.queries.length;
      for (let index = 0; index < p.queries.length; index++) {
        if (isCancelled(job.id)) return;
        for await (const progress of scrapeGoogleMaps(p.queries[index], p.options)) {
          if (isCancelled(job.id)) return;
          if (progress.type === "error") { updateJob(job.id, { status: "error", error: progress.message, finishedAt: Date.now() }); return; }
          updateJob(job.id, { progress: { current: totalScraped + progress.current, total: grandTotal, page: progress.page || 0 }, message: progress.message });
          if (progress.type === "page_done" && progress.data) {
            const existingUrls = new Set((getJob(job.id)?.results as { url?: string }[] | undefined)?.map((r) => r.url));
            for (const item of progress.data) {
              if (!existingUrls.has(item.url)) { pushResult(job.id, item); existingUrls.add(item.url); }
            }
            totalScraped += progress.data.length;
          }
        }
        if (totalScraped >= grandTotal) break;
      }
      return;
    }
  }
}

import { LinkedInCookie, ProxyConfig } from "./linkedin-scraper";
import { MapsScrapeOptions, scrapeGoogleMaps } from "./maps-scraper-v2";
import { scanProfiles } from "./profile-scanner";
import { scanCompanies } from "./company-scanner";
import { scrapeSalesNavSearch } from "./salesnav-scraper";
import { acquireScrapeJob, safeError } from "./api-security";
import { Job, JobType, createJob, getJob, pushResult, pushResults, updateJob } from "./job-store";

export interface SearchJobParams { searchUrl:string; cookies:LinkedInCookie[]; maxResults:number; mode:"leads"|"companies"; proxy?:ProxyConfig }
export interface ProfileJobParams { urls:string[]; cookies:LinkedInCookie[]; minConnections:number; minActivityMonths:number; proxy?:ProxyConfig }
export interface CompanyJobParams { urls:string[]; cookies:LinkedInCookie[]; proxy?:ProxyConfig }
export interface MapsJobParams { queries:string[]; maxResults:number; options:MapsScrapeOptions }

const queue:string[]=[];
let loopStarted=false;
export function enqueue(jobId:string){queue.push(jobId);startLoop()}
export function submitJob(type:JobType,params:unknown):Job{const job=createJob(type,params);enqueue(job.id);return job}
function startLoop(){if(loopStarted)return;loopStarted=true;void runLoop()}
async function runLoop(){for(;;){const jobId=queue.shift();if(!jobId){await new Promise((r)=>setTimeout(r,300));continue}const job=getJob(jobId);if(!job||job.status==="cancelled")continue;let release:(()=>void)|undefined;try{release=acquireScrapeJob()}catch{updateJob(jobId,{status:"error",error:"Server busy",finishedAt:Date.now()});continue}updateJob(jobId,{status:"running",startedAt:Date.now(),message:"Starting..."});try{await runJob(job);if(getJob(jobId)?.status==="running")updateJob(jobId,{status:"done",finishedAt:Date.now(),message:"Done"})}catch(error){updateJob(jobId,{status:"error",error:safeError(error),finishedAt:Date.now()})}finally{release?.();redactParams(jobId)}}}
function isCancelled(jobId:string){return getJob(jobId)?.status==="cancelled"}
function redactParams(jobId:string){const job=getJob(jobId);if(!job)return;if(job.type==="maps")updateJob(jobId,{params:undefined});else updateJob(jobId,{params:{redacted:true}})}

async function runJob(job:Job){
 switch(job.type){
  case "search":{const p=job.params as SearchJobParams;for await(const progress of scrapeSalesNavSearch(p.searchUrl,p.cookies,p.maxResults,p.mode,p.proxy)){if(isCancelled(job.id))return;if(progress.type==="error"){updateJob(job.id,{status:"error",error:progress.message,finishedAt:Date.now()});return}updateJob(job.id,{progress:{current:progress.current,total:progress.total,page:progress.page||0},message:progress.message});if(progress.type==="page_done"&&progress.data)pushResults(job.id,progress.data)}return}
  case "profile":{const p=job.params as ProfileJobParams;for await(const progress of scanProfiles(p.urls,p.cookies,{minConnections:p.minConnections,minActivityMonths:p.minActivityMonths,proxy:p.proxy})){if(isCancelled(job.id))return;if(progress.type==="error"){updateJob(job.id,{status:"error",error:progress.message,finishedAt:Date.now()});return}updateJob(job.id,{progress:{current:progress.current,total:progress.total,page:0},message:progress.message});if(progress.type==="result"&&progress.data)pushResult(job.id,progress.data)}return}
  case "company":{const p=job.params as CompanyJobParams;for await(const progress of scanCompanies(p.urls,p.cookies,{proxy:p.proxy})){if(isCancelled(job.id))return;if(progress.type==="error"){updateJob(job.id,{status:"error",error:progress.message,finishedAt:Date.now()});return}updateJob(job.id,{progress:{current:progress.current,total:progress.total,page:0},message:progress.message});if(progress.type==="result"&&progress.data)pushResult(job.id,progress.data)}return}
  case "maps":{const p=job.params as MapsJobParams;const seen=new Set<string>();for(let index=0;index<p.queries.length&&seen.size<p.maxResults;index++){if(isCancelled(job.id))return;const remaining=p.maxResults-seen.size;for await(const progress of scrapeGoogleMaps(p.queries[index],{...p.options,maxCrawledPlacesPerSearch:remaining})){if(isCancelled(job.id))return;if(progress.type==="error"){updateJob(job.id,{status:"error",error:progress.message,finishedAt:Date.now()});return}updateJob(job.id,{progress:{current:seen.size,total:p.maxResults,page:index+1},message:progress.message});if(progress.type==="page_done"&&progress.data){for(const item of progress.data){const key=item.placeId||item.url.split("?")[0];if(!seen.has(key)&&seen.size<p.maxResults){seen.add(key);pushResult(job.id,item)}}}}}updateJob(job.id,{progress:{current:seen.size,total:p.maxResults,page:p.queries.length},message:`Collected ${seen.size} unique places`});return}
 }
}

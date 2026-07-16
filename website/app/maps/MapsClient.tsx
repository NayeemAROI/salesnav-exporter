"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Check, Download, ExternalLink, Globe2, MapPin, Pause, Play, Search, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import styles from "./maps.module.css";

type Place = { title:string; placeId:string; address:string|null; categoryName:string|null; totalScore:number|null; reviewsCount:number|null; website:string|null; phone:string|null; url:string; city:string|null; permanentlyClosed:boolean; temporarilyClosed:boolean };
type Job = { id:string; status:"queued"|"running"|"done"|"error"|"cancelled"; progress:{current:number;total:number}; message:string; results:Place[]; error?:string };

const PRESETS = ["Restaurants", "Hotels", "Dentists", "Law firms", "Software companies", "Real estate agencies"];

export default function MapsClient() {
  const [mode,setMode]=useState<"single"|"batch">("single");
  const [query,setQuery]=useState("Restaurants");
  const [batch,setBatch]=useState("");
  const [location,setLocation]=useState("Dhaka, Bangladesh");
  const [limit,setLimit]=useState(100);
  const [stars,setStars]=useState(0);
  const [website,setWebsite]=useState("allPlaces");
  const [details,setDetails]=useState(true);
  const [skipClosed,setSkipClosed]=useState(true);
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState("");
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const results=job?.results||[];
  const running=job?.status==="queued"||job?.status==="running";
  const withWebsite=useMemo(()=>results.filter((r)=>r.website).length,[results]);
  const open=useMemo(()=>results.filter((r)=>!r.permanentlyClosed&&!r.temporarilyClosed).length,[results]);

  async function poll(id:string){
    const response=await fetch(`/api/jobs/${id}`);
    if(!response.ok){setError("Could not read the job. Refresh and try again.");return;}
    const data=await response.json(); setJob(data.job);
    if(["done","error","cancelled"].includes(data.job.status)&&timer.current){clearInterval(timer.current);timer.current=null;}
  }
  useEffect(()=>()=>{if(timer.current)clearInterval(timer.current)},[]);

  async function start(){
    setError(""); setJob(null);
    const searches=mode==="single"?[query]:batch.split(/\r?\n/).map((v)=>v.trim()).filter(Boolean);
    if(!searches.length){setError("Add at least one search query.");return;}
    const response=await fetch("/api/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"maps",searchStringsArray:searches,locationQuery:location,maxCrawledPlacesPerSearch:limit,placeMinimumStars:stars||undefined,website,skipClosedPlaces:skipClosed,scrapePlaceDetailPage:details})});
    const data=await response.json();
    if(!response.ok){setError(data.error||"Could not start the Maps collector.");return;}
    const placeholder:Job={id:data.jobId,status:"queued",progress:{current:0,total:limit},message:"Queued",results:[]};setJob(placeholder);
    await poll(data.jobId); timer.current=setInterval(()=>poll(data.jobId),2000);
  }
  async function stop(){if(!job)return;await fetch(`/api/jobs/${job.id}`,{method:"DELETE"});await poll(job.id)}
  function csv(){
    if(!results.length)return; const columns=["title","categoryName","address","city","totalScore","reviewsCount","website","phone","url"] as const;
    const esc=(value:unknown)=>{let text=String(value??"");if(/^[=+\-@]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`};
    const content=[columns.join(","),...results.map((row)=>columns.map((column)=>esc(row[column])).join(","))].join("\n");
    const href=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=href;anchor.download=`maps-${Date.now()}.csv`;anchor.click();URL.revokeObjectURL(href);
  }

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/dashboard" className={styles.back}><ArrowLeft size={18}/> Dashboard</Link><div className={styles.brand}><span className={styles.logo}><MapPin size={19}/></span><div><b>Maps Collector</b><small>Local market intelligence</small></div></div><span className={`${styles.state} ${running?styles.live:""}`}><i/>{running?"Collecting":"Ready"}</span></header>
    <section className={styles.intro}><div><span className={styles.eyebrow}>Google Maps workspace</span><h1>Build a clean local business list.</h1><p>Search one market or many, apply quality filters, then export deduplicated business records.</p></div><div className={styles.summary}><div><b>{results.length}</b><span>places</span></div><div><b>{withWebsite}</b><span>websites</span></div><div><b>{open}</b><span>open</span></div></div></section>
    <section className={styles.workspace}>
      <aside className={styles.controls}><div className={styles.mode}><button className={mode==="single"?styles.selected:""} onClick={()=>setMode("single")}>Single search</button><button className={mode==="batch"?styles.selected:""} onClick={()=>setMode("batch")}>Batch</button></div>
        {mode==="single"?<label>What are you looking for?<input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Restaurants"/></label>:<label>Queries, one per line<textarea value={batch} onChange={(e)=>setBatch(e.target.value)} placeholder={"Restaurants\nHotels\nDentists"}/></label>}
        <div className={styles.presets}>{PRESETS.map((preset)=><button key={preset} onClick={()=>mode==="single"?setQuery(preset):setBatch((old)=>old?`${old}\n${preset}`:preset)}>{preset}</button>)}</div>
        <label>Location<input value={location} onChange={(e)=>setLocation(e.target.value)} placeholder="Dhaka, Bangladesh"/></label>
        <div className={styles.two}><label>Maximum results<input type="number" min="1" max="500" value={limit} onChange={(e)=>setLimit(Math.min(500,Math.max(1,Number(e.target.value)||1)))}/></label><label>Minimum rating<select value={stars} onChange={(e)=>setStars(Number(e.target.value))}><option value="0">Any</option><option value="3">3.0+</option><option value="3.5">3.5+</option><option value="4">4.0+</option><option value="4.5">4.5+</option></select></label></div>
        <label>Website filter<select value={website} onChange={(e)=>setWebsite(e.target.value)}><option value="allPlaces">All places</option><option value="withWebsite">With website</option><option value="withoutWebsite">Without website</option></select></label>
        <div className={styles.checks}><label><input type="checkbox" checked={details} onChange={(e)=>setDetails(e.target.checked)}/><span><b>Open place details</b><small>Slower, includes phone and website</small></span></label><label><input type="checkbox" checked={skipClosed} onChange={(e)=>setSkipClosed(e.target.checked)}/><span><b>Skip closed businesses</b><small>Exclude temporary and permanent closures</small></span></label></div>
        {error&&<div className={styles.error}>{error}</div>}
        <div className={styles.actions}>{running?<button className={styles.stop} onClick={stop}><Pause size={17}/>Stop job</button>:<button className={styles.run} onClick={start}><Play size={17}/>Collect places</button>}<button className={styles.clear} onClick={()=>{setJob(null);setError("")}}><Trash2 size={17}/></button></div>
      </aside>
      <section className={styles.results}>
        <div className={styles.resultHead}><div><span className={styles.eyebrow}>Results</span><h2>{job?.message||"Ready for a search"}</h2></div><button className={styles.export} onClick={csv} disabled={!results.length}><Download size={16}/>Export CSV</button></div>
        {job&&<div className={styles.progress}><span style={{width:`${Math.min(100,Math.round((job.progress.current/Math.max(job.progress.total,1))*100))}%`}}/></div>}
        {!results.length?<div className={styles.empty}><span><Search size={30}/></span><h3>No places collected yet</h3><p>Choose a business type and location. Results will appear here while the background job runs.</p></div>:<div className={styles.list}>{results.map((place,index)=><article key={place.placeId||place.url} className={styles.place}><span className={styles.rank}>{String(index+1).padStart(2,"0")}</span><div className={styles.placeMain}><div className={styles.titleRow}><h3>{place.title}</h3>{place.totalScore&&<span className={styles.rating}><Star size={13} fill="currentColor"/>{place.totalScore} <small>({place.reviewsCount||0})</small></span>}</div><p><MapPin size={14}/>{place.address||"Address unavailable"}</p><div className={styles.meta}>{place.categoryName&&<span><Building2 size={13}/>{place.categoryName}</span>}{place.website&&<a href={place.website} target="_blank" rel="noreferrer"><Globe2 size={13}/>Website</a>}{!place.permanentlyClosed&&!place.temporarilyClosed&&<span className={styles.open}><Check size={13}/>Open</span>}</div></div><a className={styles.openMap} href={place.url} target="_blank" rel="noreferrer" aria-label={`Open ${place.title} in Maps`}><ExternalLink size={17}/></a></article>)}</div>}
      </section>
    </section>
  </main>
}

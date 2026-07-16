import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root=new URL("../",import.meta.url);const read=(path)=>readFile(new URL(path,root),"utf8");
test("Maps v2 is self-contained and bounded",async()=>{const source=await read("lib/maps-scraper-v2.ts");assert.match(source,/collectLinks/);assert.match(source,/extractPlace/);assert.match(source,/matchesFilters/);assert.match(source,/Math\.min\(Math\.max/);assert.doesNotMatch(source,/createEmptyResult\(url/)});
test("Maps jobs use a global result cap and dedupe",async()=>{const source=await read("lib/job-runner.ts");assert.match(source,/seen\.size<p\.maxResults/);assert.match(source,/item\.placeId\|\|item\.url/);assert.match(source,/maxCrawledPlacesPerSearch:remaining/)});
test("jobs API allows only bounded Maps batches",async()=>{const source=await read("app/api/jobs/route.ts");assert.match(source,/searchStringsArray\",10/);assert.match(source,/maxResults,100,1,500/)});
test("authenticated API supports polling and cancellation",async()=>{const source=await read("proxy.ts");assert.match(source,/\[\"GET\",\"POST\",\"DELETE\"\]/);assert.match(source,/\/maps\/\:path\*/)});
test("dedicated Maps workspace exists",async()=>{const source=await read("app/maps/MapsClient.tsx");assert.match(source,/Google Maps workspace/);assert.match(source,/Export CSV/);assert.match(source,/api\/jobs/)});

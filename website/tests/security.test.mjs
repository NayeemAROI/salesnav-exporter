import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("all scraper routes use the shared security boundary", async () => {
  for (const route of ["search", "profile", "maps"]) {
    const source = await read(`app/api/scrape/${route}/route.ts`);
    assert.match(source, /assertBodySize\(req\)/);
    assert.match(source, /acquireScrapeJob\(\)/);
    assert.match(source, /req\.signal\.aborted/);
    assert.doesNotMatch(source, /body\.proxy\b/);
  }
});

test("URL and cookie inputs are strictly allowlisted", async () => {
  const source = await read("lib/api-security.ts");
  assert.match(source, /url\.hostname !== "www\.linkedin\.com"/);
  assert.match(source, /Only Google Maps HTTPS URLs are allowed/);
  assert.match(source, /new Set\(\["li_at", "JSESSIONID"\]\)/);
  assert.match(source, /domain: "\.linkedin\.com"/);
  assert.match(source, /const MAX_ACTIVE_JOBS = 1/);
});

test("production fails closed without authentication", async () => {
  const source = await read("proxy.ts");
  assert.match(source, /NODE_ENV === "production"/);
  assert.match(source, /BASIC_AUTH_USER/);
  assert.match(source, /BASIC_AUTH_PASSWORD/);
  assert.match(source, /status: 503/);
});

test("container runs the standalone app as non-root", async () => {
  const dockerfile = await read("Dockerfile");
  assert.match(dockerfile, /USER nextjs/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.doesNotMatch(dockerfile, /CMD \["npm", "start"\]/);
});

test("Next.js is pinned above the affected 16.2.4 release", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.dependencies.next, "16.2.10");
  assert.equal(pkg.devDependencies["eslint-config-next"], "16.2.10");
});

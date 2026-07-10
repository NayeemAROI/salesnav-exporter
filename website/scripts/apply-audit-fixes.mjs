import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let source = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (source.includes(before)) source = source.replace(before, after);
    else if (!source.includes(after)) throw new Error(`Expected source not found in ${path}: ${before.slice(0, 80)}`);
  }
  await writeFile(path, source);
}

await patch("app/dashboard/DashboardClient.tsx", [
  [
    `const esc = (v: unknown) => { const s = String(v ?? "").replace(/"/g, '\"\"'); return /[,"\\n\\r]/.test(s) ? \`"\${s}"\` : s; };`,
    `const esc = (v: unknown) => {\n      let s = String(v ?? "");\n      if (/^[=+\\-@]/.test(s)) s = "'" + s;\n      s = s.replace(/"/g, '\"\"');\n      return /[,"\\n\\r]/.test(s) ? \`"\${s}"\` : s;\n    };`
  ],
  [`}, [cookieSaved, searchUrl, maxResults, liAt, jsessionId]);`, `}, [cookieSaved, searchUrl, maxResults, liAt, jsessionId, proxyCountry]);`],
  [`}, [cookieSaved, profileUrls, liAt, jsessionId, minConnections, minActivityMonths]);`, `}, [cookieSaved, profileUrls, liAt, jsessionId, minConnections, minActivityMonths, proxyCountry]);`]
]);

await patch("app/salesnav-exporter/page.tsx", [
  [
    `desc: "All data stays in your browser. Zero external servers, zero tracking, zero data sharing.",`,
    `desc: "The Chrome extension processes data locally. The separate web dashboard runs protected scraping jobs on your configured server.",`
  ],
  [
    `a: "Nowhere. All processing happens locally in your browser. We don't have servers, analytics, or any external connections. Your data is 100% yours.",`,
    `a: "The Chrome extension processes exports locally. If you use the protected web dashboard, LinkedIn session cookies are sent to your own configured server for the duration of the scraping request and are not intentionally persisted.",`
  ]
]);

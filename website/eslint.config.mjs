import { defineConfig,globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([...nextVitals,...nextTs,{files:["lib/maps-scraper.ts","lib/maps-scraper-v2.ts","lib/linkedin-scraper.ts","lib/profile-scanner.ts","lib/company-scanner.ts","lib/salesnav-scraper.ts","app/dashboard/DashboardClient.tsx"],rules:{"@typescript-eslint/no-explicit-any":"off","prefer-const":"off","react/no-unescaped-entities":"off"}},globalIgnores([".next/**","out/**","build/**","next-env.d.ts"])]);

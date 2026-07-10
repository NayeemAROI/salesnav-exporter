import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["lib/maps-scraper.ts", "lib/linkedin-scraper.ts", "app/dashboard/DashboardClient.tsx"],
    rules: {
      // Browser-evaluated DOM payloads are intentionally dynamic at the external boundary.
      // Runtime allowlists and request validation live in lib/api-security.ts.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;

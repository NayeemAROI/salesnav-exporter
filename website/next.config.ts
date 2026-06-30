import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer-extra", "puppeteer-extra-plugin-stealth"],
};

export default nextConfig;

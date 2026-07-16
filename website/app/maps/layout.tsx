import type { Metadata } from "next";
export const metadata: Metadata = { title: "Google Maps Collector", robots: { index: false, follow: false } };
export default function MapsLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SalesNav Exporter — Extract LinkedIn Sales Navigator Leads in Seconds",
  description:
    "Free Chrome extension to export leads from LinkedIn Sales Navigator. CSV & JSON export, deep profile scanning, company data extraction. No signup required.",
  keywords: [
    "LinkedIn",
    "Sales Navigator",
    "Chrome Extension",
    "Lead Export",
    "CSV",
    "Profile Scanner",
    "Lead Generation",
    "Sales Tool",
  ],
  openGraph: {
    title: "SalesNav Exporter — Free Chrome Extension",
    description: "Extract leads from LinkedIn Sales Navigator in seconds, not hours.",
    type: "website",
    images: ["/salesnav/preview2.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SalesNav Exporter",
    description: "Extract leads from LinkedIn Sales Navigator in seconds.",
    images: ["/salesnav/preview2.png"],
  },
};

export default function SalesNavLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

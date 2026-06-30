"use client";

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("./DashboardClient"), { ssr: false });

export default function DashboardPage() {
  return <Dashboard />;
}

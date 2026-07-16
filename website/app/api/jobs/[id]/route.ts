import { NextRequest } from "next/server";
import { getJob, updateJob } from "@/lib/job-store";

export const dynamic = "force-dynamic";

function toResponseJob(job: NonNullable<ReturnType<typeof getJob>>) {
  const mode = job.type === "search" ? (job.params as { mode?: "leads" | "companies" } | undefined)?.mode : undefined;
  return {
    id: job.id, type: job.type, status: job.status,
    progress: job.progress, message: job.message, results: job.results, error: job.error,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    mode,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json({ job: toResponseJob(job) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  if (job.status === "queued" || job.status === "running") {
    updateJob(id, { status: "cancelled", finishedAt: Date.now(), message: "Cancelled" });
  }
  return Response.json({ job: toResponseJob(getJob(id)!) });
}

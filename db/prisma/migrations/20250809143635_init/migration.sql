-- CreateEnum
CREATE TYPE "public"."PipelineStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "public"."pipeline_runs" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "jobId" TEXT,
    "repoName" TEXT NOT NULL,
    "repoFullName" TEXT,
    "repoUrl" TEXT NOT NULL,
    "branch" TEXT,
    "status" "public"."PipelineStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerCommitId" TEXT,
    "triggerMessage" TEXT,
    "triggerAuthorName" TEXT,
    "triggerAuthorEmail" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "logsUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pipeline_logs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "step" TEXT,

    CONSTRAINT "pipeline_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_runs_executionId_key" ON "public"."pipeline_runs"("executionId");

-- CreateIndex
CREATE INDEX "pipeline_logs_runId_idx" ON "public"."pipeline_logs"("runId");

-- AddForeignKey
ALTER TABLE "public"."pipeline_logs" ADD CONSTRAINT "pipeline_logs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

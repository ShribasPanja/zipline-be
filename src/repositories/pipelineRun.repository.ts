import { DbService } from "../services/db.service";

// Local enum type matching Prisma schema to avoid missing generated types
export type PipelineStatusLocal =
  | "QUEUED"
  | "IN_PROGRESS"
  | "SUCCESS"
  | "FAILED";

export type CreatePipelineRunInput = {
  executionId: string;
  jobId?: string;
  repoName: string;
  repoFullName?: string;
  repoUrl: string;
  branch?: string;
  status?: PipelineStatusLocal;
  triggerCommitId?: string;
  triggerMessage?: string;
  triggerAuthorName?: string;
  triggerAuthorEmail?: string;
  queuedAt?: Date;
};

export type UpdatePipelineRunInput = {
  status?: PipelineStatusLocal;
  jobId?: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  durationMs?: number | null;
  logsUrl?: string | null;
  errorMessage?: string | null;
};

export const PipelineRunRepository = {
  async create(input: CreatePipelineRunInput) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.pipelineRun.create({
        data: {
          executionId: input.executionId,
          jobId: input.jobId,
          repoName: input.repoName,
          repoFullName: input.repoFullName,
          repoUrl: input.repoUrl,
          branch: input.branch,
          status: input.status ?? "QUEUED",
          triggerCommitId: input.triggerCommitId,
          triggerMessage: input.triggerMessage,
          triggerAuthorName: input.triggerAuthorName,
          triggerAuthorEmail: input.triggerAuthorEmail,
          queuedAt: input.queuedAt ?? new Date(),
        },
      });
    } catch (error) {
      console.warn("[DB] Failed to create pipeline run:", error);
      return undefined;
    }
  },

  async updateByExecutionId(
    executionId: string,
    changes: UpdatePipelineRunInput
  ) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.pipelineRun.update({
        where: { executionId },
        data: {
          status: changes.status,
          jobId: changes.jobId,
          startedAt: changes.startedAt ?? undefined,
          finishedAt: changes.finishedAt ?? undefined,
          durationMs: changes.durationMs ?? undefined,
          logsUrl: changes.logsUrl ?? undefined,
          errorMessage: changes.errorMessage ?? undefined,
        },
      });
    } catch (error) {
      console.warn("[DB] Failed to update pipeline run:", error);
      return undefined;
    }
  },

  async findByExecutionId(executionId: string) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.pipelineRun.findUnique({ where: { executionId } });
    } catch (error) {
      console.warn("[DB] Failed to find pipeline run:", error);
      return undefined;
    }
  },

  async list(params?: { repoName?: string; limit?: number }) {
    const prisma = DbService.getClient();
    if (!prisma) return [];
    try {
  const where: any = {};
      if (params?.repoName) where.repoName = params.repoName;
      return await prisma.pipelineRun.findMany({
        where,
        orderBy: { queuedAt: "desc" },
        take: params?.limit ?? 50,
      });
    } catch (error) {
      console.warn("[DB] Failed to list pipeline runs:", error);
      return [];
    }
  },

  async getStats() {
    const prisma = DbService.getClient();
    if (!prisma) return null;
    try {
      const [total, queued, inProgress, success, failed] = await Promise.all([
        prisma.pipelineRun.count(),
        prisma.pipelineRun.count({ where: { status: "QUEUED" } }),
        prisma.pipelineRun.count({ where: { status: "IN_PROGRESS" } }),
        prisma.pipelineRun.count({ where: { status: "SUCCESS" } }),
        prisma.pipelineRun.count({ where: { status: "FAILED" } }),
      ]);
      return { total, queued, inProgress, success, failed };
    } catch (error) {
      console.warn("[DB] Failed to get pipeline stats:", error);
      return null;
    }
  },
};

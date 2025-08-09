import { DbService } from "../services/db.service";

export type CreateLogInput = {
  runId: string;
  level?: string;
  message: string;
  step?: string;
};

export const PipelineLogRepository = {
  async create(input: CreateLogInput) {
    const prisma = DbService.getClient();
    if (!prisma) {
      console.warn("[DB] Prisma client not available");
      return undefined;
    }
    try {
      console.log(
        `[DB] Creating pipeline log for runId: ${input.runId}, level: ${input.level}, step: ${input.step}`
      );
      const result = await prisma.pipelineLog.create({
        data: {
          runId: input.runId,
          level: input.level ?? "info",
          message: input.message,
          step: input.step,
        },
      });
      console.log(
        `[DB] Successfully created pipeline log with ID: ${result.id}`
      );
      return result;
    } catch (error) {
      console.warn("[DB] Failed to create pipeline log:", error);
      return undefined;
    }
  },

  async getLogsByExecutionId(executionId: string) {
    const prisma = DbService.getClient();
    if (!prisma) return [];
    try {
      return await prisma.pipelineLog.findMany({
        where: {
          run: {
            executionId: executionId,
          },
        },
        orderBy: {
          timestamp: "asc",
        },
      });
    } catch (error) {
      console.warn("[DB] Failed to get pipeline logs:", error);
      return [];
    }
  },

  async getLogsByRunId(runId: string) {
    const prisma = DbService.getClient();
    if (!prisma) return [];
    try {
      return await prisma.pipelineLog.findMany({
        where: {
          runId: runId,
        },
        orderBy: {
          timestamp: "asc",
        },
      });
    } catch (error) {
      console.warn("[DB] Failed to get pipeline logs:", error);
      return [];
    }
  },
};

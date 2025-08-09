import { Request, Response } from "express";
import { PipelineHelper } from "../helpers/pipeline.helper";
import { ActivityService } from "../services/activity.service";
import { PipelineService } from "../services/pipeline.service";
import { ResponseHelper } from "../helpers/response.helper";
import { DockerExecutionService } from "../services/docker.service";
import { PipelineLogRepository } from "../repositories/pipelineLog.repository";

export class PipelineController {
  static async executePipeline(req: Request, res: Response) {
    try {
      const { repoUrl, repoName, branch } = req.body;

      // Validate required fields
      if (!repoUrl || !repoName) {
        return ResponseHelper.error(
          res,
          "Repository URL and name are required",
          400
        );
      }

      // Always execute pipeline asynchronously via queue
      console.log(
        `[API] Starting pipeline execution for ${repoName} via queue`
      );

      const executionId = await PipelineService.executePipelineAsync(
        repoUrl,
        repoName,
        branch,
        {
          name: repoName,
          full_name: repoName,
        }
      );

      console.log(`[API] Pipeline queued with execution ID: ${executionId}`);

      return ResponseHelper.success(
        res,
        {
          executionId,
          status: "queued",
          message: "Pipeline execution queued successfully",
        },
        "Pipeline execution queued"
      );
    } catch (error: any) {
      console.error("[API] Pipeline execution failed:", error);

      // Log pipeline failure activity
      const { repoName, repoUrl } = req.body;
      if (repoName) {
        ActivityService.addActivity({
          type: "pipeline_execution",
          status: "failed",
          repository: {
            name: repoName,
            full_name: repoName,
          },
          metadata: {
            error: error.message,
            repoUrl: repoUrl || "",
          },
        });
      }

      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  static async getExecutionStatus(req: Request, res: Response) {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        return ResponseHelper.error(res, "Execution ID is required", 400);
      }

      const execution = PipelineService.getExecution(executionId);

      if (!execution) {
        return ResponseHelper.error(res, "Execution not found", 404);
      }

      return ResponseHelper.success(
        res,
        execution,
        "Execution status retrieved"
      );
    } catch (error: any) {
      console.error("[API] Get execution status failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  static async getExecutionLogs(req: Request, res: Response) {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        return ResponseHelper.error(res, "Execution ID is required", 400);
      }

      // Get pipeline run info
      const { PipelineRunRepository } = await import(
        "../repositories/pipelineRun.repository"
      );
      const pipelineRun = await PipelineRunRepository.findByExecutionId(
        executionId
      );

      if (!pipelineRun) {
        return ResponseHelper.error(res, "Pipeline execution not found", 404);
      }

      // Get logs
      const logs = await PipelineLogRepository.getLogsByExecutionId(
        executionId
      );

      return ResponseHelper.success(
        res,
        {
          id: pipelineRun.id,
          executionId: pipelineRun.executionId,
          status: pipelineRun.status.toLowerCase(),
          repoName: pipelineRun.repoName,
          repoUrl: pipelineRun.repoUrl,
          branch: pipelineRun.branch,
          triggerCommit: pipelineRun.triggerCommitId,
          triggerAuthorName: pipelineRun.triggerAuthorName,
          triggerAuthorEmail: pipelineRun.triggerAuthorEmail,
          startedAt: pipelineRun.queuedAt,
          completedAt: pipelineRun.finishedAt,
          logs: logs.map((log) => ({
            id: log.id,
            timestamp: log.timestamp,
            level: log.level,
            message: log.message,
            step: log.step,
          })),
        },
        "Execution logs retrieved"
      );
    } catch (error: any) {
      console.error("[API] Get execution logs failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  static async getExecutions(req: Request, res: Response) {
    try {
      const { repoName, limit } = req.query;

      // Get pipeline runs from database
      const { PipelineRunRepository } = await import(
        "../repositories/pipelineRun.repository"
      );
      const executions = await PipelineRunRepository.list({
        repoName: repoName as string,
        limit: limit ? parseInt(limit as string) : 50,
      });

      // Calculate basic stats
      const total = executions.length;
      const successful = executions.filter(
        (e) => e.status === "SUCCESS"
      ).length;
      const failed = executions.filter((e) => e.status === "FAILED").length;
      const inProgress = executions.filter(
        (e) => e.status === "IN_PROGRESS"
      ).length;

      const stats = {
        total,
        successful,
        failed,
        inProgress,
        successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      };

      return ResponseHelper.success(
        res,
        {
          executions: executions.map((exec) => ({
            id: exec.id,
            executionId: exec.executionId,
            repoName: exec.repoName,
            repoUrl: exec.repoUrl,
            branch: exec.branch,
            status: exec.status.toLowerCase(),
            triggerCommit: exec.triggerCommitId,
            triggerAuthorName: exec.triggerAuthorName,
            triggerAuthorEmail: exec.triggerAuthorEmail,
            startedAt: exec.queuedAt,
            completedAt: exec.finishedAt,
            duration: exec.durationMs
              ? `${Math.round(exec.durationMs / 1000)}s`
              : null,
          })),
          stats,
        },
        "Executions retrieved"
      );
    } catch (error: any) {
      console.error("[API] Get executions failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  static async validatePipelineConfig(req: Request, res: Response) {
    try {
      const { repoUrl, repoName } = req.body;

      if (!repoUrl || !repoName) {
        return ResponseHelper.error(
          res,
          "Repository URL and name are required",
          400
        );
      }

      // This would typically clone the repo temporarily to check for pipeline config
      // For now, we'll return a simple validation
      return ResponseHelper.success(
        res,
        {
          hasConfig: true,
          configPath: ".zipline/pipeline.yml",
        },
        "Pipeline configuration validated"
      );
    } catch (error: any) {
      console.error("[API] Pipeline validation failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  static async getPipelineStatus(req: Request, res: Response) {
    try {
      const dockerAvailable =
        await DockerExecutionService.validateDockerAvailability();
      const stats = PipelineService.getExecutionStats();

      return ResponseHelper.success(
        res,
        {
          dockerAvailable,
          status: dockerAvailable ? "ready" : "docker_unavailable",
          executions: stats,
        },
        "Pipeline status retrieved"
      );
    } catch (error: any) {
      console.error("[API] Pipeline status check failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  static async cleanupExecutions(req: Request, res: Response) {
    try {
      const { maxAge } = req.body;
      const maxAgeMs = maxAge
        ? parseInt(maxAge) * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000; // default 24 hours

      PipelineService.cleanupOldExecutions(maxAgeMs);

      return ResponseHelper.success(res, null, "Old executions cleaned up");
    } catch (error: any) {
      console.error("[API] Cleanup executions failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }
}

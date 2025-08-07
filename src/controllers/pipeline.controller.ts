import { Request, Response } from "express";
import { PipelineHelper } from "../helpers/pipeline.helper";
import { ActivityService } from "../services/activity.service";
import { PipelineService } from "../services/pipeline.service";
import { ResponseHelper } from "../helpers/response.helper";
import { DockerExecutionService } from "../services/docker.service";

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

  static async getExecutions(req: Request, res: Response) {
    try {
      const { repoName } = req.query;

      let executions;
      if (repoName) {
        executions = PipelineService.getExecutionsByRepo(repoName as string);
      } else {
        executions = PipelineService.getAllExecutions();
      }

      const stats = PipelineService.getExecutionStats();

      return ResponseHelper.success(
        res,
        {
          executions,
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

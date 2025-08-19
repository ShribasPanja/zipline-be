import { Request, Response } from "express";
import { PipelineHelper } from "../helpers/pipeline.helper";
import { ActivityService } from "../services/activity.service";
import { PipelineService } from "../services/pipeline.service";
import { ResponseHelper } from "../helpers/response.helper";
import { DockerExecutionService } from "../services/docker.service";
import { PipelineLogRepository } from "../repositories/pipelineLog.repository";

export class PipelineController {
  static async executePipeline(req: Request, res: Response) {
    const { repoUrl, repoName, branch } = req.body;

    // Validate required fields
    if (!repoUrl || !repoName) {
      return ResponseHelper.error(
        res,
        "Repository URL and name are required",
        400
      );
    }

    // Get user info from authentication header for manual executions
    let userInfo: any = undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        const { GitHubService } = await import("../services/github.service");
        userInfo = await GitHubService.getUserInfo(token);
        console.log(
          `[API] Manual execution by user: ${userInfo.login} (${userInfo.id})`
        );
      } catch (error) {
        console.warn(
          "[API] Could not get user info for manual execution:",
          error
        );
      }
    }

    try {
      // All pipeline executions now use DAG orchestrator (supports both parallel and sequential steps)
      console.log(`[API] Starting DAG pipeline execution for ${repoName}`);

      const executionId = await PipelineService.executePipelineDAG(
        repoUrl,
        repoName,
        branch,
        { name: repoName, full_name: repoName },
        undefined, // no trigger commit for manual executions
        userInfo
          ? {
              userId: userInfo.id.toString(),
              login: userInfo.login,
              name: userInfo.name || userInfo.login,
              email: userInfo.email,
            }
          : undefined
      );

      console.log(
        `[API] DAG pipeline queued with execution ID: ${executionId}`
      );

      return ResponseHelper.success(
        res,
        {
          executionId,
          status: "queued",
          message: "Pipeline execution queued successfully (DAG mode)",
        },
        "Pipeline execution queued"
      );
    } catch (error: any) {
      console.error("[API] Pipeline execution failed:", error);

      // Log pipeline failure activity
      const { repoName, repoUrl } = req.body;
      if (repoName && userInfo) {
        ActivityService.addActivity({
          type: "pipeline_execution",
          status: "failed",
          repository: {
            name: repoName,
            full_name: repoName,
          },
          user: {
            id: userInfo.id.toString(),
            login: userInfo.login,
            name: userInfo.name || userInfo.login,
            email: userInfo.email,
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
          logs: logs.map((log: any) => ({
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

      // Require authentication to get executions
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return ResponseHelper.error(
          res,
          "Authentication required to view executions",
          401
        );
      }

      // Get current user from token to filter executions
      let currentUser: any;
      try {
        const token = authHeader.substring(7);
        const { GitHubService } = await import("../services/github.service");
        currentUser = await GitHubService.getUserInfo(token);
        console.log(
          `[API] Filtering executions for user: ${currentUser.login} (ID: ${currentUser.id})`
        );
      } catch (userError) {
        console.error(
          "[API] Failed to get user info for filtering:",
          userError
        );
        return ResponseHelper.error(res, "Invalid authentication token", 401);
      }

      // Get pipeline runs from database - only for the authenticated user
      const { PipelineRunRepository } = await import(
        "../repositories/pipelineRun.repository"
      );

      // First, let's see all executions to debug
      const allExecutions = await PipelineRunRepository.list({
        repoName: repoName as string,
        limit: limit ? parseInt(limit as string) : 50,
      });
      console.log(`[API] Total executions in DB: ${allExecutions.length}`);
      console.log(
        `[API] Sample triggerUserIds:`,
        allExecutions.slice(0, 5).map((e) => ({
          id: e.id,
          triggerUserId: e.triggerUserId,
          triggerUserLogin: e.triggerUserLogin,
          repoName: e.repoName,
        }))
      );

      const executions = await PipelineRunRepository.list({
        repoName: repoName as string,
        limit: limit ? parseInt(limit as string) : 50,
        triggerUserId: currentUser.id.toString(), // Filter by current user ID
      });
      console.log(
        `[API] Filtered executions for user ${currentUser.id}: ${executions.length}`
      );

      // Calculate basic stats
      const total = executions.length;
      const successful = executions.filter(
        (e: any) => e.status === "SUCCESS"
      ).length;
      const failed = executions.filter(
        (e: any) => e.status === "FAILED"
      ).length;
      const inProgress = executions.filter(
        (e: any) => e.status === "IN_PROGRESS"
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
          executions: executions.map((exec: any) => ({
            id: exec.id,
            executionId: exec.executionId,
            repoName: exec.repoName,
            repoUrl: exec.repoUrl,
            branch: exec.branch,
            status: exec.status.toLowerCase(),
            triggerCommit: exec.triggerCommitId,
            triggerAuthorName: exec.triggerAuthorName,
            triggerAuthorEmail: exec.triggerAuthorEmail,
            triggerUserId: exec.triggerUserId,
            triggerUserLogin: exec.triggerUserLogin,
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

  static async getAllExecutionsDebug(req: Request, res: Response) {
    try {
      const { limit } = req.query;

      // Get all pipeline runs from database for debugging
      const { PipelineRunRepository } = await import(
        "../repositories/pipelineRun.repository"
      );
      const executions = await PipelineRunRepository.list({
        limit: limit ? parseInt(limit as string) : 50,
      });

      console.log(`[DEBUG] Total executions in DB: ${executions.length}`);
      console.log(
        `[DEBUG] All triggerUserIds:`,
        executions.map((e) => ({
          id: e.id,
          triggerUserId: e.triggerUserId,
          triggerUserLogin: e.triggerUserLogin,
          triggerAuthorName: e.triggerAuthorName,
          repoName: e.repoName,
        }))
      );

      return ResponseHelper.success(
        res,
        {
          executions: executions.map((exec: any) => ({
            id: exec.id,
            executionId: exec.executionId,
            repoName: exec.repoName,
            repoUrl: exec.repoUrl,
            branch: exec.branch,
            status: exec.status.toLowerCase(),
            triggerCommit: exec.triggerCommitId,
            triggerAuthorName: exec.triggerAuthorName,
            triggerAuthorEmail: exec.triggerAuthorEmail,
            triggerUserId: exec.triggerUserId,
            triggerUserLogin: exec.triggerUserLogin,
            startedAt: exec.queuedAt,
            completedAt: exec.finishedAt,
            duration: exec.durationMs
              ? `${Math.round(exec.durationMs / 1000)}s`
              : null,
          })),
          total: executions.length,
        },
        "All executions retrieved (DEBUG)"
      );
    } catch (error: any) {
      console.error("[API] Get all executions debug failed:", error);
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

  static async getDAGVisualization(req: Request, res: Response) {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        return ResponseHelper.error(res, "Execution ID is required", 400);
      }

      // Get pipeline run info from database
      const { PipelineRunRepository } = await import(
        "../repositories/pipelineRun.repository"
      );
      const pipelineRun = await PipelineRunRepository.findByExecutionId(
        executionId
      );

      if (!pipelineRun) {
        return ResponseHelper.error(res, "Pipeline execution not found", 404);
      }

      // Clone repository and read actual pipeline.yml
      let tempDir: string;
      let pipelineSteps: any[] = [];

      try {
        console.log(
          `[DAG] Cloning repository for DAG visualization: ${pipelineRun.repoUrl}`
        );
        const pipeRes = await PipelineHelper.executePipeline(
          pipelineRun.repoUrl,
          pipelineRun.repoName,
          pipelineRun.branch || "main",
          true // validate only, don't execute
        );

        if (!pipeRes.success || !pipeRes.tempDir) {
          throw new Error(pipeRes.error || "Failed to clone repository");
        }

        tempDir = pipeRes.tempDir;
        const yamlPath = require("path").join(tempDir, ".zipline/pipeline.yml");

        if (!require("fs").existsSync(yamlPath)) {
          throw new Error("Pipeline configuration not found in repository");
        }

        console.log(`[DAG] Reading pipeline.yml from: ${yamlPath}`);
        const pipeline = await PipelineHelper.readYamlConfig(yamlPath);
        pipelineSteps = pipeline.steps || [];

        console.log(
          `[DAG] Found ${pipelineSteps.length} steps in pipeline.yml`
        );

        // Cleanup temp directory after reading
        setTimeout(() => {
          try {
            if (require("fs").existsSync(tempDir)) {
              require("fs").rmSync(tempDir, { recursive: true, force: true });
              console.log(`[DAG] Cleaned up temp directory: ${tempDir}`);
            }
          } catch (cleanupError) {
            console.warn(
              `[DAG] Failed to cleanup temp directory: ${cleanupError}`
            );
          }
        }, 1000);
      } catch (error: any) {
        console.error(`[DAG] Error reading pipeline.yml:`, error);
        return ResponseHelper.error(
          res,
          `Failed to read pipeline configuration: ${error.message}`,
          500
        );
      }

      if (!pipelineSteps || pipelineSteps.length === 0) {
        return ResponseHelper.error(
          res,
          "No pipeline steps found in configuration",
          404
        );
      }

      // Transform to ReactFlow format using actual pipeline data
      const dagData = PipelineController.transformToReactFlow(pipelineSteps);

      const response = {
        executionId,
        repoName: pipelineRun.repoName,
        branch: pipelineRun.branch || "main",
        nodes: dagData.nodes,
        edges: dagData.edges,
        totalSteps: pipelineSteps.length,
        pipelineConfig: {
          steps: pipelineSteps.map((step) => ({
            name: step.name,
            image: step.image,
            needs: step.needs || [],
            run: step.run || [],
          })),
        },
      };

      return ResponseHelper.success(
        res,
        response,
        "DAG visualization data retrieved successfully"
      );
    } catch (error: any) {
      console.error("[API] Get DAG visualization failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Internal server error",
        500
      );
    }
  }

  private static transformToReactFlow(steps: any[]) {
    // Create a dependency map for better layout calculation
    const stepMap = new Map();
    steps.forEach((step) => {
      stepMap.set(step.name, step);
    });

    // Calculate levels (depth) for each step based on dependencies
    const levelMap = new Map<string, number>();
    const calculateLevel = (stepName: string, visited = new Set()): number => {
      if (visited.has(stepName)) {
        console.warn(
          `[DAG] Circular dependency detected involving step: ${stepName}`
        );
        return 0; // Break circular dependency
      }

      if (levelMap.has(stepName)) {
        return levelMap.get(stepName)!;
      }

      const step = stepMap.get(stepName);
      if (!step || !step.needs || step.needs.length === 0) {
        levelMap.set(stepName, 0);
        return 0;
      }

      visited.add(stepName);
      const maxDepLevel = Math.max(
        ...step.needs.map((dep: string) =>
          calculateLevel(dep, new Set(visited))
        )
      );
      const level = maxDepLevel + 1;
      levelMap.set(stepName, level);
      visited.delete(stepName);
      return level;
    };

    // Calculate levels for all steps
    steps.forEach((step) => calculateLevel(step.name));

    // Group steps by level for better positioning
    const levelGroups = new Map<number, string[]>();
    for (const [stepName, level] of levelMap.entries()) {
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level)!.push(stepName);
    }

    // Create nodes with improved positioning
    const nodes = steps.map((step, index) => {
      const level = levelMap.get(step.name) || 0;
      const stepsAtLevel = levelGroups.get(level) || [];
      const indexAtLevel = stepsAtLevel.indexOf(step.name);
      const totalAtLevel = stepsAtLevel.length;

      // Calculate position with better spacing
      const xSpacing = 400; // Increased horizontal spacing between levels
      const ySpacing = 250; // Increased vertical spacing between nodes
      const yOffset =
        totalAtLevel > 1
          ? (indexAtLevel - (totalAtLevel - 1) / 2) * ySpacing
          : 0;

      // Determine node type based on dependencies
      const dependencies = step.needs || [];
      const isRoot = dependencies.length === 0;
      const isLeaf = !steps.some((s) => s.needs && s.needs.includes(step.name));

      let nodeColor = "#1f2937"; // default
      let borderColor = "#374151"; // default
      let textColor = "#10b981"; // green

      if (isRoot) {
        nodeColor = "#0f172a"; // darker for root nodes
        borderColor = "#1e40af"; // blue border for starting nodes
        textColor = "#3b82f6"; // blue text
      } else if (isLeaf) {
        nodeColor = "#1a1a1a"; // darker for leaf nodes
        borderColor = "#dc2626"; // red border for final nodes
        textColor = "#f87171"; // red text
      }

      return {
        id: step.name,
        type: "default",
        position: {
          x: level * xSpacing + 50,
          y: yOffset + 100,
        },
        data: {
          label: step.name,
          image: step.image || "alpine:latest",
          dependencies: dependencies,
          commands: step.run || [],
          isRoot,
          isLeaf,
          level,
          description: step.description || "",
        },
        style: {
          background: nodeColor,
          color: textColor,
          border: `2px solid ${borderColor}`,
          borderRadius: "8px",
          fontSize: "12px",
          fontFamily: "monospace",
          padding: "12px",
          minWidth: "220px",
          minHeight: "90px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
        },
      };
    });

    // Create edges with enhanced styling and labels
    const edges: any[] = [];
    steps.forEach((step) => {
      const dependencies = step.needs || [];
      dependencies.forEach((dep: string, index: number) => {
        const sourceLevel = levelMap.get(dep) || 0;
        const targetLevel = levelMap.get(step.name) || 0;
        const isLongDistance = targetLevel - sourceLevel > 1;

        edges.push({
          id: `${dep}-${step.name}`,
          source: dep,
          target: step.name,
          type: "smoothstep",
          animated: true,
          style: {
            stroke: "#22c55e",
            strokeWidth: 4,
            strokeDasharray: isLongDistance ? "10,5" : "none",
          },
          markerEnd: {
            type: "arrowclosed",
            width: 20,
            height: 20,
            color: "#22c55e",
          },
          label: `dependency`,
          labelStyle: {
            fill: "#f3f4f6",
            fontWeight: 600,
            fontSize: 11,
            fontFamily: "monospace",
          },
          labelBgStyle: {
            fill: "#1f2937",
            fillOpacity: 0.95,
            rx: 6,
            ry: 3,
          },
          labelBgPadding: [8, 12],
          labelShowBg: true,
        });
      });
    });

    // Add flow statistics
    const stats = {
      totalSteps: steps.length,
      maxLevel: Math.max(...Array.from(levelMap.values())),
      rootSteps: steps.filter((s) => !s.needs || s.needs.length === 0).length,
      leafSteps: steps.filter(
        (s) =>
          !steps.some((other) => other.needs && other.needs.includes(s.name))
      ).length,
      totalDependencies: edges.length,
    };

    console.log(
      `[DAG] Generated flow: ${stats.totalSteps} steps, ${
        stats.maxLevel + 1
      } levels, ${stats.totalDependencies} dependencies`
    );

    return { nodes, edges, stats };
  }
}

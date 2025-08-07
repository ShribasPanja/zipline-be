import { addPipelineJob, getPipelineJobStatus } from "../queue/pipeline.queue";

export interface PipelineExecution {
  id: string;
  repoName: string;
  repoUrl: string;
  branch?: string;
  status: "queued" | "running" | "completed" | "failed";
  startTime: Date;
  endTime?: Date;
  result?: any;
  jobId?: string;
}

export class PipelineService {
  private static executions: Map<string, PipelineExecution> = new Map();

  static async executePipelineAsync(
    repoUrl: string,
    repoName: string,
    branch?: string,
    repository?: { name: string; full_name: string },
    triggerCommit?: { id: string; message: string }
  ): Promise<string> {
    const executionId = `${repoName}-${Date.now()}`;

    const execution: PipelineExecution = {
      id: executionId,
      repoName,
      repoUrl,
      branch,
      status: "queued",
      startTime: new Date(),
    };

    this.executions.set(executionId, execution);

    try {
      // Add job to the queue instead of running directly
      const queueExecutionId = await addPipelineJob({
        repoUrl,
        repoName,
        branch,
        repository: repository || { name: repoName, full_name: repoName },
        triggerCommit,
      });

      // Update execution with queue execution ID
      execution.id = queueExecutionId;
      execution.status = "queued";
      this.executions.set(queueExecutionId, execution);
      this.executions.delete(executionId);

      console.log(
        `[PIPELINE_SERVICE] Pipeline queued successfully with execution ID: ${queueExecutionId}`
      );
      return queueExecutionId;
    } catch (error: any) {
      console.error(`[PIPELINE_SERVICE] Failed to queue pipeline:`, error);
      execution.status = "failed";
      execution.endTime = new Date();
      execution.result = { error: error.message };
      throw error;
    }
  }

  static async getExecution(
    executionId: string
  ): Promise<PipelineExecution | undefined> {
    const localExecution = this.executions.get(executionId);

    if (localExecution) {
      // Update status from queue if available
      try {
        const queueStatus = await getPipelineJobStatus(executionId);
        if (queueStatus.status !== "not_found") {
          localExecution.status = this.mapQueueStatusToExecutionStatus(
            queueStatus.status
          );
          if (queueStatus.finishedOn) {
            localExecution.endTime = new Date(queueStatus.finishedOn);
          }
        }
      } catch (error) {
        console.warn(
          `[PIPELINE_SERVICE] Failed to get queue status for ${executionId}:`,
          error
        );
      }
    }

    return localExecution;
  }

  private static mapQueueStatusToExecutionStatus(
    queueStatus: string
  ): "queued" | "running" | "completed" | "failed" {
    switch (queueStatus) {
      case "waiting":
      case "delayed":
        return "queued";
      case "active":
        return "running";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      default:
        return "queued";
    }
  }

  static getAllExecutions(): PipelineExecution[] {
    return Array.from(this.executions.values());
  }

  static getExecutionsByRepo(repoName: string): PipelineExecution[] {
    return Array.from(this.executions.values()).filter(
      (exec) => exec.repoName === repoName
    );
  }

  static cleanupOldExecutions(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, execution] of this.executions.entries()) {
      const age = now - execution.startTime.getTime();
      if (age > maxAge && execution.status !== "running") {
        toDelete.push(id);
      }
    }

    toDelete.forEach((id) => {
      this.executions.delete(id);
      console.log(`[PIPELINE_SERVICE] Cleaned up old execution: ${id}`);
    });
  }

  static getExecutionStats(): {
    total: number;
    running: number;
    completed: number;
    failed: number;
  } {
    const executions = Array.from(this.executions.values());

    return {
      total: executions.length,
      running: executions.filter((e) => e.status === "running").length,
      completed: executions.filter((e) => e.status === "completed").length,
      failed: executions.filter((e) => e.status === "failed").length,
    };
  }
}

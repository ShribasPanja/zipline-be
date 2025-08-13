import { Request, Response } from "express";
import { getPipelineJobStatus, pipelineQueue } from "../queue/pipeline.queue";
import {
  addDAGPipelineJob,
  dagStepQueue,
  dagOrchestratorQueue,
  cancelDAGExecution,
} from "../queue/dag-pipeline.queue";
import { PipelineRunRepository } from "../repositories/pipelineRun.repository";
import SocketService from "../services/socket.service";

export class QueueController {
  static async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const { executionId } = req.params;

      const status = await getPipelineJobStatus(executionId);

      res.json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      console.error("[QUEUE_CONTROLLER] Error getting job status:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getQueueStats(req: Request, res: Response): Promise<void> {
    try {
      const waiting = await pipelineQueue.getWaiting();
      const active = await pipelineQueue.getActive();
      const completed = await pipelineQueue.getCompleted();
      const failed = await pipelineQueue.getFailed();

      res.json({
        success: true,
        data: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          total:
            waiting.length + active.length + completed.length + failed.length,
        },
      });
    } catch (error: any) {
      console.error("[QUEUE_CONTROLLER] Error getting queue stats:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async getRecentJobs(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 10;

      const [waiting, active, completed, failed] = await Promise.all([
        pipelineQueue.getWaiting(0, limit),
        pipelineQueue.getActive(0, limit),
        pipelineQueue.getCompleted(0, limit),
        pipelineQueue.getFailed(0, limit),
      ]);

      const jobs = [...waiting, ...active, ...completed, ...failed]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit)
        .map((job) => ({
          id: job.id,
          name: job.name,
          data: job.data,
          progress: job.progress,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
          failedReason: job.failedReason,
          returnvalue: job.returnvalue,
          opts: job.opts,
        }));

      res.json({
        success: true,
        data: jobs,
      });
    } catch (error: any) {
      console.error("[QUEUE_CONTROLLER] Error getting recent jobs:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async cancelJob(req: Request, res: Response): Promise<void> {
    try {
      const { executionId } = req.params;
      const socket = SocketService.getInstance();

      // First check if this is a DAG execution
      if (executionId.startsWith("dag-")) {
        // Mark the execution as cancelled first
        cancelDAGExecution(executionId);

        // Cancel DAG pipeline jobs
        const [activeStepJobs, activeDagJobs, waitingStepJobs, waitingDagJobs] =
          await Promise.all([
            dagStepQueue.getActive(),
            dagOrchestratorQueue.getActive(),
            dagStepQueue.getWaiting(),
            dagOrchestratorQueue.getWaiting(),
          ]);

        let cancelledJobs = 0;
        let forceCancelledJobs = 0;

        // Function to safely cancel a job
        const cancelJobSafely = async (job: any, queueName: string) => {
          try {
            // First try to remove normally (for waiting jobs)
            await job.remove();
            cancelledJobs++;
            console.log(
              `[CANCEL] Successfully removed ${queueName} job ${job.id}`
            );
          } catch (error: any) {
            if (error.message.includes("locked")) {
              try {
                // For locked jobs, try to move to failed state
                await job.moveToFailed({ message: "Cancelled by user" });
                forceCancelledJobs++;
                console.log(
                  `[CANCEL] Force-failed locked ${queueName} job ${job.id}`
                );
              } catch (failError) {
                console.error(
                  `[CANCEL] Failed to cancel locked ${queueName} job ${job.id}:`,
                  failError instanceof Error
                    ? failError.message
                    : String(failError)
                );
                // Mark it in our database anyway
                forceCancelledJobs++;
              }
            } else {
              console.error(
                `[CANCEL] Error cancelling ${queueName} job ${job.id}:`,
                error.message
              );
            }
          }
        };

        // Cancel waiting step jobs for this execution (these should remove easily)
        for (const job of waitingStepJobs) {
          if (job.data.executionId === executionId) {
            await cancelJobSafely(job, "step-waiting");
          }
        }

        // Cancel waiting orchestrator jobs for this execution
        for (const job of waitingDagJobs) {
          if (job.data.executionId === executionId) {
            await cancelJobSafely(job, "dag-waiting");
          }
        }

        // Cancel active step jobs for this execution (these might be locked)
        for (const job of activeStepJobs) {
          if (job.data.executionId === executionId) {
            await cancelJobSafely(job, "step-active");
          }
        }

        // Cancel active orchestrator jobs for this execution (these might be locked)
        for (const job of activeDagJobs) {
          if (job.data.executionId === executionId) {
            await cancelJobSafely(job, "dag-active");
          }
        }

        // Update database status
        await PipelineRunRepository.updateByExecutionId(executionId, {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: "Pipeline cancelled by user",
        }).catch(() => {});

        // Emit cancellation status
        socket.emitPipelineStatus(executionId, "failed", {
          error: "Pipeline cancelled by user",
          cancelled: true,
        });

        const totalCancelled = cancelledJobs + forceCancelledJobs;
        res.json({
          success: true,
          message: `Pipeline cancelled successfully. ${totalCancelled} jobs terminated (${cancelledJobs} removed, ${forceCancelledJobs} force-failed).`,
          data: {
            executionId,
            cancelledJobs,
            forceCancelledJobs,
            totalCancelled,
          },
        });
      } else {
        // Handle regular pipeline cancellation
        const [activeJobs, waitingJobs] = await Promise.all([
          pipelineQueue.getActive(),
          pipelineQueue.getWaiting(),
        ]);
        let cancelled = false;

        // Function to safely cancel a regular pipeline job
        const cancelRegularJob = async (job: any, isActive: boolean) => {
          try {
            await job.remove();
            cancelled = true;
            console.log(
              `[CANCEL] Successfully removed ${
                isActive ? "active" : "waiting"
              } job ${job.id}`
            );
          } catch (error: any) {
            if (error.message.includes("locked")) {
              try {
                await job.moveToFailed({ message: "Cancelled by user" });
                cancelled = true;
                console.log(`[CANCEL] Force-failed locked job ${job.id}`);
              } catch (failError) {
                console.error(
                  `[CANCEL] Failed to cancel locked job ${job.id}:`,
                  failError instanceof Error
                    ? failError.message
                    : String(failError)
                );
                cancelled = true; // Mark as cancelled anyway since we'll update the DB
              }
            } else {
              console.error(
                `[CANCEL] Error cancelling job ${job.id}:`,
                error.message
              );
            }
          }
        };

        // Try waiting jobs first (easier to cancel)
        for (const job of waitingJobs) {
          if (job.data.executionId === executionId) {
            await cancelRegularJob(job, false);
            break;
          }
        }

        // If not found in waiting, try active jobs
        if (!cancelled) {
          for (const job of activeJobs) {
            if (job.data.executionId === executionId) {
              await cancelRegularJob(job, true);
              break;
            }
          }
        }

        if (!cancelled) {
          // Check waiting jobs
          const waitingJobs = await pipelineQueue.getWaiting();
          for (const job of waitingJobs) {
            if (job.data.executionId === executionId) {
              await job.remove();
              cancelled = true;
              break;
            }
          }
        }

        if (cancelled) {
          // Update database status
          await PipelineRunRepository.updateByExecutionId(executionId, {
            status: "FAILED",
            finishedAt: new Date(),
            errorMessage: "Pipeline cancelled by user",
          }).catch(() => {});

          // Emit cancellation status
          socket.emitPipelineStatus(executionId, "failed", {
            error: "Pipeline cancelled by user",
            cancelled: true,
          });

          res.json({
            success: true,
            message: "Pipeline cancelled successfully",
            data: { executionId },
          });
        } else {
          res.status(404).json({
            success: false,
            error: "No active or waiting job found for this execution ID",
          });
        }
      }
    } catch (error: any) {
      console.error("[QUEUE_CONTROLLER] Error cancelling job:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  static async rerunJob(req: Request, res: Response): Promise<void> {
    try {
      const { executionId } = req.params;

      // Get the original pipeline run details
      const originalRun = await PipelineRunRepository.findByExecutionId(
        executionId
      );

      if (!originalRun) {
        res.status(404).json({
          success: false,
          error: "Original pipeline run not found",
        });
        return;
      }

      // Check if this was a DAG execution
      if (executionId.startsWith("dag-")) {
        // Create new DAG pipeline job
        const newExecutionId = await addDAGPipelineJob({
          repoUrl: originalRun.repoUrl,
          repoName: originalRun.repoName,
          branch: originalRun.branch || "main",
          repository: {
            name: originalRun.repoName,
            full_name: originalRun.repoFullName || originalRun.repoName,
          },
        });

        res.json({
          success: true,
          message: "DAG pipeline rerun initiated successfully",
          data: {
            originalExecutionId: executionId,
            newExecutionId: newExecutionId,
          },
        });
      } else {
        // Handle regular pipeline rerun - you'll need to implement this based on your regular pipeline logic
        res.status(501).json({
          success: false,
          error: "Regular pipeline rerun not yet implemented",
        });
      }
    } catch (error: any) {
      console.error("[QUEUE_CONTROLLER] Error rerunning job:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

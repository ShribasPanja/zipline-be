import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PipelineHelper } from "../helpers/pipeline.helper";
import { DockerExecutionService } from "../services/docker.service";
import { ActivityService } from "../services/activity.service";
import { PipelineLoggerService } from "../services/pipelineLogger.service";
import { PipelineRunRepository } from "../repositories/pipelineRun.repository";
import SocketService from "../services/socket.service";
import { existsSync } from "fs";
import path from "path";

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on("connect", () => {
  console.log("[QUEUE] Connected to Redis successfully");
});

connection.on("error", (error) => {
  console.error("[QUEUE] Redis connection error:", error.message);
  console.error(
    "[QUEUE] Make sure Redis is running on the configured host/port"
  );
});

interface PipelineJobData {
  repoUrl: string;
  repoName: string;
  branch?: string;
  executionId: string;
  repository: {
    name: string;
    full_name: string;
  };
  triggerCommit?: {
    id: string;
    message: string;
  };
  triggerAuthorName?: string;
  triggerAuthorEmail?: string;
  triggerUserId?: string; // GitHub user ID who triggered the pipeline
  triggerUserLogin?: string; // GitHub username who triggered the pipeline
}

export const pipelineQueue = new Queue<PipelineJobData>("pipeline-jobs", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

export const pipelineWorker = new Worker<PipelineJobData>(
  "pipeline-jobs",
  async (job: Job<PipelineJobData>) => {
    const {
      repoUrl,
      repoName,
      branch,
      executionId,
      repository,
      triggerCommit,
    } = job.data;

    console.log(
      `[QUEUE] Processing pipeline job ${job.id} for ${repoName} (execution: ${executionId})`
    );

    const logger = new PipelineLoggerService(executionId);
    await logger.init();

    const socketService = SocketService.getInstance();

    try {
      await job.updateProgress(10);
      await logger.info(`Pipeline execution started for ${repoName}`, "QUEUE");
      socketService.emitPipelineStatus(executionId, "running", {
        step: "initialization",
        progress: 10,
      });

      await ActivityService.addPipelineExecutionActivity(
        {
          type: "pipeline_execution",
          repository,
          status: "in_progress",
          metadata: {
            executionId,
            jobId: job.id,
            trigger: "webhook",
            commit_id: triggerCommit?.id,
            branch: branch || "main",
            started_at: new Date().toISOString(),
          },
        },
        repository.full_name
      );

      await job.updateProgress(20);
      socketService.emitPipelineStatus(executionId, "running", {
        step: "cloning",
        progress: 20,
      });

      await logger.info(
        `Starting repository clone and validation for ${branch || "main"}`,
        "CLONE"
      );
      console.log(
        `[QUEUE] Starting pipeline validation for ${repoName}${
          branch ? ` on branch ${branch}` : ""
        }`
      );
      const pipelineResult = await PipelineHelper.executePipeline(
        repoUrl,
        repoName,
        branch,
        true
      );

      if (!pipelineResult.success) {
        await logger.error(
          `Pipeline validation failed: ${pipelineResult.error}`,
          "CLONE"
        );
        throw new Error(pipelineResult.error || "Pipeline validation failed");
      }

      await logger.info(
        "Repository cloned and pipeline.yml validated successfully",
        "CLONE"
      );

      await job.updateProgress(40);

      const tempDir = pipelineResult.tempDir;
      if (!tempDir || !existsSync(tempDir)) {
        throw new Error(
          "Temporary directory not available after pipeline validation"
        );
      }

      const yamlPath = path.join(tempDir, ".zipline/pipeline.yml");

      if (existsSync(yamlPath)) {
        const pipeline = await PipelineHelper.readYamlConfig(yamlPath);

        await job.updateProgress(50);
        socketService.emitPipelineStatus(executionId, "running", {
          step: "execution",
          progress: 50,
        });

        try {
          await PipelineRunRepository.updateByExecutionId(executionId, {
            status: "IN_PROGRESS",
            startedAt: new Date(),
          });
          console.log(
            `[QUEUE] Updated database status to IN_PROGRESS for execution: ${executionId}`
          );
        } catch (dbError) {
          console.warn(`[QUEUE] Failed to update database status: ${dbError}`);
        }

        await logger.info(
          `Starting execution of ${pipeline.steps.length} pipeline steps`,
          "DOCKER"
        );
        console.log(
          `[QUEUE] Executing ${pipeline.steps.length} pipeline steps`
        );

        const onDockerOutput = async (
          output: string,
          isError: boolean = false
        ) => {
          const cleanOutput = output.trim();
          if (cleanOutput) {
            if (isError) {
              await logger.error(cleanOutput, "DOCKER");
            } else {
              await logger.info(cleanOutput, "DOCKER");
            }
          }
        };

        try {
          const dockerResult =
            await DockerExecutionService.executePipelineSteps(
              pipeline.steps,
              tempDir,
              onDockerOutput,
              executionId
            );

          for (const step of dockerResult.steps) {
            if (step.success) {
              await logger.info(
                `Step "${step.name}" completed successfully in ${step.duration}ms`,
                "SUMMARY"
              );
            } else {
              await logger.error(
                `Step "${step.name}" failed: ${step.error}`,
                "SUMMARY"
              );
            }
          }

          await job.updateProgress(90);
          socketService.emitPipelineStatus(executionId, "running", {
            step: "finalizing",
            progress: 90,
          });

          const finalResult = {
            success: dockerResult.success,
            error: dockerResult.error,
            duration: pipelineResult.duration,
            steps: dockerResult.steps,
          };

          if (finalResult.success) {
            await logger.info(
              "All pipeline steps completed successfully",
              "DOCKER"
            );

            try {
              await PipelineRunRepository.updateByExecutionId(executionId, {
                status: "SUCCESS",
                finishedAt: new Date(),
                durationMs: finalResult.duration,
              });
              console.log(
                `[QUEUE] Updated database with success status for execution: ${executionId}`
              );
            } catch (dbError) {
              console.warn(
                `[QUEUE] Failed to update database with success: ${dbError}`
              );
            }

            socketService.emitPipelineStatus(executionId, "success", {
              duration: finalResult.duration,
              stepsCompleted: finalResult.steps.filter((s: any) => s.success)
                .length,
              totalSteps: finalResult.steps.length,
            });
          } else {
            await logger.error(
              `Pipeline execution failed: ${finalResult.error}`,
              "DOCKER"
            );

            try {
              await PipelineRunRepository.updateByExecutionId(executionId, {
                status: "FAILED",
                finishedAt: new Date(),
                errorMessage: finalResult.error,
                durationMs: finalResult.duration,
              });
              console.log(
                `[QUEUE] Updated database with failure status for execution: ${executionId}`
              );
            } catch (dbError) {
              console.warn(
                `[QUEUE] Failed to update database with failure: ${dbError}`
              );
            }

            socketService.emitPipelineStatus(executionId, "failed", {
              error: finalResult.error,
              stepsCompleted: finalResult.steps.filter((s: any) => s.success)
                .length,
              totalSteps: finalResult.steps.length,
            });
          }

          await ActivityService.addPipelineExecutionActivity(
            {
              type: "pipeline_execution",
              status: finalResult.success ? "success" : "failed",
              repository,
              metadata: {
                executionId,
                jobId: job.id,
                duration: `${Math.round(finalResult.duration / 1000)}s`,
                steps_completed: finalResult.steps.filter((s: any) => s.success)
                  .length,
                total_steps: finalResult.steps.length,
                error: finalResult.error || undefined,
                repoUrl,
                branch: branch || "main",
                completed_at: new Date().toISOString(),
              },
            },
            repository.full_name
          );

          await job.updateProgress(100);

          try {
            if (existsSync(tempDir)) {
              console.log(
                `[QUEUE] Cleaning up temporary directory: ${tempDir}`
              );
              const { rm } = await import("fs/promises");
              await rm(tempDir, { recursive: true, force: true });
              await logger.info("Temporary directory cleaned up", "CLEANUP");
            }
          } catch (cleanupError) {
            console.warn(
              `[QUEUE] Failed to cleanup temp directory: ${cleanupError}`
            );
            await logger.warn(
              `Failed to cleanup temp directory: ${cleanupError}`,
              "CLEANUP"
            );
          }

          console.log(`[QUEUE] Pipeline job ${job.id} completed successfully`);
          return {
            success: true,
            executionId,
            result: finalResult,
          };
        } catch (dockerError: any) {
          console.error(
            `[QUEUE] Docker execution failed:`,
            dockerError.message
          );
          await logger.error(
            `Docker execution failed: ${dockerError.message}`,
            "DOCKER_ERROR"
          );

          socketService.emitPipelineStatus(executionId, "failed", {
            error: dockerError.message,
          });

          throw dockerError;
        }
      } else {
        await logger.error(
          "Pipeline configuration not found after cloning",
          "VALIDATION"
        );
        throw new Error("Pipeline configuration not found after cloning");
      }
    } catch (error: any) {
      console.error(`[QUEUE] Pipeline job ${job.id} failed:`, error.message);
      await logger.error(
        `Pipeline execution failed: ${error.message}`,
        "ERROR"
      );

      socketService.emitPipelineStatus(executionId, "failed", {
        error: error.message,
      });

      await ActivityService.addPipelineExecutionActivity(
        {
          type: "pipeline_execution",
          status: "failed",
          repository,
          metadata: {
            executionId,
            jobId: job.id,
            error: error.message,
            repoUrl,
            branch: branch || "main",
            failed_at: new Date().toISOString(),
          },
        },
        repository.full_name
      );

      throw error;
    }
  },
  {
    connection,
    concurrency: 3,
  }
);

pipelineQueue.on("error", (error) => {
  console.error("[QUEUE] Pipeline queue error:", error);
});

pipelineWorker.on("error", (error) => {
  console.error("[QUEUE] Pipeline worker error:", error);
});

pipelineWorker.on("failed", (job, error) => {
  console.error(`[QUEUE] Job ${job?.id} failed:`, error.message);
});

pipelineWorker.on("completed", (job, result) => {
  console.log(`[QUEUE] Job ${job.id} completed successfully`);
});

console.log("[QUEUE] Pipeline queue and worker initialized");

export async function addPipelineJob(
  data: Omit<PipelineJobData, "executionId">
): Promise<string> {
  const executionId = `${data.repoName}-${Date.now()}`;

  try {
    await PipelineRunRepository.create({
      executionId,
      jobId: "pending",
      repoName: data.repoName,
      repoFullName: data.repository.full_name,
      repoUrl: data.repoUrl,
      branch: data.branch,
      status: "QUEUED",
      triggerCommitId: data.triggerCommit?.id,
      triggerMessage: data.triggerCommit?.message,
      triggerAuthorName: data.triggerAuthorName,
      triggerAuthorEmail: data.triggerAuthorEmail,
      triggerUserId: data.triggerUserId,
      triggerUserLogin: data.triggerUserLogin,
    });
    console.log(
      `[QUEUE] Created database record for execution: ${executionId}`
    );
  } catch (dbError) {
    console.warn(`[QUEUE] Failed to create database record: ${dbError}`);
    throw dbError;
  }

  const job = await pipelineQueue.add(
    "execute-pipeline",
    {
      ...data,
      executionId,
    },
    {
      priority: 1,
      delay: 0,
    }
  );

  console.log(
    `[QUEUE] Added pipeline job ${job.id} for ${data.repoName} (execution: ${executionId})`
  );

  try {
    await PipelineRunRepository.updateByExecutionId(executionId, {
      jobId: String(job.id),
    });
  } catch (updateError) {
    console.warn(`[QUEUE] Failed to update job ID: ${updateError}`);
  }

  return executionId;
}

export async function getPipelineJobStatus(executionId: string) {
  const jobs = await pipelineQueue.getJobs([
    "waiting",
    "active",
    "completed",
    "failed",
  ]);
  const job = jobs.find((j) => j.data.executionId === executionId);

  if (!job) {
    return { status: "not_found" };
  }

  return {
    status: await job.getState(),
    progress: job.progress,
    data: job.data,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
  };
}

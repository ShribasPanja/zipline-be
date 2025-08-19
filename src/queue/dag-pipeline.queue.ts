import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import {
  PipelineOrchestrator,
  DAGExecutionPlan,
  StepLike,
} from "../services/orchestrator.service";
import { DockerExecutionService } from "../services/docker.service";
import { PipelineLoggerService } from "../services/pipelineLogger.service";
import { ArtifactService } from "../services/artifact.service";
import { SecretsService } from "../services/secrets.service";
import SocketService from "../services/socket.service";
import { PipelineRunRepository } from "../repositories/pipelineRun.repository";
import { ActivityService } from "../services/activity.service";
import { PipelineHelper } from "../helpers/pipeline.helper";
import path from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
const execPromise = promisify(exec);


const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

interface StepJobData {
  executionId: string;
  stepName: string;
  step: StepLike;
  workingDir: string;
  repoName: string;
  repository: { name: string; full_name: string };
}

interface OrchestratorJobData {
  repoUrl: string;
  repoName: string;
  branch?: string;
  executionId: string;
  repository: { name: string; full_name: string };
  triggerCommit?: { id: string; message: string };
  triggerAuthorName?: string;
  triggerAuthorEmail?: string;
  triggerUserId?: string; // GitHub user ID who triggered the pipeline
  triggerUserLogin?: string; // GitHub username who triggered the pipeline
}

const activePlans = new Map<string, DAGExecutionPlan>();
const activeSchedulers = new Map<string, { cleanup: () => void }>();
const cancelledExecutions = new Set<string>();

function setupParallelScheduler(
  executionId: string,
  plan: DAGExecutionPlan,
  workingDir: string,
  repoName: string,
  repository: { name: string; full_name: string },
  logger: PipelineLoggerService,
  socket: any
) {
  const scheduleReadySteps = async () => {
    const ready = PipelineOrchestrator.getReadySteps(plan).filter(
      (name) => plan.nodes.get(name)?.status === "pending"
    );

    if (ready.length > 0) {
      await logger.info(
        `Scheduling ${ready.length} ready steps in parallel: ${ready.join(
          ", "
        )}`,
        "SCHEDULER"
      );

      const queuePromises = ready.map(async (name) => {
        const node = plan.nodes.get(name)!;
        PipelineOrchestrator.updateStepStatus(plan, name, "queued");
        await logger.info(
          `Queuing step "${name}" for parallel execution`,
          "SCHEDULER"
        );
        return dagStepQueue.add("run", {
          executionId,
          stepName: name,
          step: node.step,
          workingDir,
          repoName,
          repository,
        });
      });

      await Promise.all(queuePromises);
      await logger.info(
        `Successfully queued ${ready.length} steps for parallel execution`,
        "SCHEDULER"
      );
    } else {
      await logger.info("No new steps ready for scheduling", "SCHEDULER");
    }

    return ready.length;
  };

  const onStepCompleted = async (
    stepJob: Job<StepJobData> | undefined,
    result: any
  ) => {
    if (!stepJob || stepJob?.data?.executionId !== executionId) return;

    const stepName = stepJob.data.stepName;
    await logger.info(
      `Step "${stepName}" completed, checking for newly ready steps`,
      "SCHEDULER"
    );

    const newlyScheduled = await scheduleReadySteps();

    if (newlyScheduled > 0) {
      await logger.info(
        `Scheduled ${newlyScheduled} newly ready steps after "${stepName}" completion`,
        "SCHEDULER"
      );
    }

    if (PipelineOrchestrator.isPipelineComplete(plan)) {
      await logger.info(
        "All steps completed, finalizing pipeline",
        "SCHEDULER"
      );
      cleanup();
      await finalize(executionId, plan, stepJob.data);
    }
  };

  const onStepFailed = async (
    stepJob: Job<StepJobData> | undefined,
    error: Error,
    prev: string
  ) => {
    if (!stepJob || stepJob?.data?.executionId !== executionId) return;

    const stepName = stepJob.data.stepName;
    await logger.error(
      `Step "${stepName}" failed: ${error.message}`,
      "SCHEDULER"
    );

    const newlyScheduled = await scheduleReadySteps();

    if (PipelineOrchestrator.isPipelineComplete(plan)) {
      await logger.info(
        "Pipeline completed with failures, finalizing",
        "SCHEDULER"
      );
      cleanup();
      await finalize(executionId, plan, stepJob.data);
    }
  };

  const cleanup = () => {
    dagStepWorker.off("completed", onStepCompleted);
    dagStepWorker.off("failed", onStepFailed);
    activeSchedulers.delete(executionId);
  };

  dagStepWorker.on("completed", onStepCompleted);
  dagStepWorker.on("failed", onStepFailed);

  activeSchedulers.set(executionId, { cleanup });

  scheduleReadySteps().then((initialCount) => {
    logger.info(
      `Initial parallel scheduling completed: ${initialCount} steps queued`,
      "SCHEDULER"
    );
  });
}

export const dagStepQueue = new Queue<StepJobData>("dag-step", { connection });
export const dagOrchestratorQueue = new Queue<OrchestratorJobData>(
  "dag-orchestrator",
  { connection }
);

export const dagStepWorker = new Worker<StepJobData>(
  "dag-step",
  async (job: Job<StepJobData>) => {
    const { executionId, stepName, step, workingDir, repoName, repository } =
      job.data;
    const repoFullName = repository.full_name;
    const logger = new PipelineLoggerService(executionId, repoFullName);
    await logger.init();
    const socket = SocketService.getInstance();
    const artifactService = new ArtifactService();

    if (isExecutionCancelled(executionId)) {
      await logger.warn(
        `Step "${stepName}" skipped - execution cancelled`,
        stepName
      );
      throw new Error(`Execution ${executionId} was cancelled`);
    }

    const plan = activePlans.get(executionId);
    if (plan) PipelineOrchestrator.updateStepStatus(plan, stepName, "running");
    await logger.info(`--- Executing step: ${stepName} ---`, "DAG_STEP");

    socket.emitStepStatus(executionId, stepName, "running", {
      startTime: new Date().toISOString(),
    });

    const onDockerOutput = async (output: string, isError: boolean = false) => {
      const cleanOutput = output.trim();
      if (cleanOutput) {
        if (isError) {
          await logger.error(cleanOutput, stepName);
        } else {
          await logger.info(cleanOutput, stepName);
        }
      }
    };

    try {
      let secretEnvVars: string[] = [];
      try {
        secretEnvVars = await SecretsService.getDockerEnvVarsForRepository(
          repoFullName
        );
        if (secretEnvVars.length > 0) {
          await logger.info(
            `Loaded ${secretEnvVars.length} secrets for step "${stepName}"`,
            stepName
          );
        }
      } catch (secretError: any) {
        await logger.warn(
          `Failed to load secrets for step "${stepName}": ${secretError.message}`,
          stepName
        );
      }

      await logger.info(
        `Starting Docker execution for step "${stepName}" with image ${step.image}`,
        stepName
      );

      if (isExecutionCancelled(executionId)) {
        await logger.warn(
          `Step "${stepName}" cancelled before Docker execution`,
          stepName
        );
        throw new Error(`Execution ${executionId} was cancelled`);
      }

      const result = await DockerExecutionService.executeStep(
        step as any,
        workingDir,
        onDockerOutput,
        secretEnvVars,
        executionId
      );
      await logger.info(
        `Step "${stepName}" completed successfully in ${result.duration}ms`,
        stepName
      );

      if (plan) {
        PipelineOrchestrator.updateStepStatus(plan, stepName, "completed");

        await logger.info(
          `Checking artifacts for step "${stepName}": ${JSON.stringify(
            step.artifacts
          )}`,
          stepName
        );

        if (
          step.artifacts &&
          step.artifacts.paths &&
          step.artifacts.paths.length > 0
        ) {
          try {
            await logger.info(
              `Saving artifacts for step "${stepName}": ${step.artifacts.paths.join(
                ", "
              )}`,
              stepName
            );

            const artifactResults = await artifactService.saveArtifacts(
              executionId,
              stepName,
              workingDir,
              step.artifacts,
              true
            );

            const successfulArtifacts = artifactResults.filter(
              (r) => r.success
            );
            const failedArtifacts = artifactResults.filter((r) => !r.success);

            if (successfulArtifacts.length > 0) {
              await logger.info(
                `Successfully saved ${successfulArtifacts.length} artifacts for step "${stepName}"`,
                stepName
              );
            }

            if (failedArtifacts.length > 0) {
              await logger.warn(
                `Failed to save ${
                  failedArtifacts.length
                } artifacts for step "${stepName}": ${failedArtifacts
                  .map((f) => f.error)
                  .join(", ")}`,
                stepName
              );
            }
          } catch (artifactError: any) {
            await logger.error(
              `Failed to save artifacts for step "${stepName}": ${artifactError.message}`,
              stepName
            );
          }
        } else {
          await logger.info(
            `No artifacts configured for step "${stepName}"`,
            stepName
          );
        }

        socket.emitStepStatus(executionId, stepName, "success", {
          endTime: new Date().toISOString(),
          duration: result.duration,
        });
      }
      return { success: true };
    } catch (e: any) {
      await logger.error(`Step "${stepName}" failed: ${e.message}`, stepName);
      if (plan) {
        PipelineOrchestrator.updateStepStatus(
          plan,
          stepName,
          "failed",
          e.message
        );

        socket.emitStepStatus(executionId, stepName, "failed", {
          endTime: new Date().toISOString(),
          error: e.message,
        });

        socket.emitPipelineStatus(executionId, "failed", {
          failedStep: stepName,
          error: e.message,
        });
      }
      throw e;
    }
  },
  { connection, concurrency: 5 }
);

export const dagOrchestratorWorker = new Worker<OrchestratorJobData>(
  "dag-orchestrator",
  async (job: Job<OrchestratorJobData>) => {
    const { repoUrl, repoName, branch, executionId, repository } = job.data;
    const logger = new PipelineLoggerService(executionId, repository.full_name);
    await logger.init();
    const socket = SocketService.getInstance();

    try {
      await logger.info(
        `DAG pipeline execution started for ${repoName}`,
        "DAG_ORCHESTRATOR"
      );

      socket.emitPipelineStatus(executionId, "running", {
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
            branch: branch || "main",
            mode: "DAG",
            started_at: new Date().toISOString(),
          },
        },
        repository.full_name
      );

      await PipelineRunRepository.updateByExecutionId(executionId, {
        status: "IN_PROGRESS",
        startedAt: new Date(),
      }).catch(() => {});

      await logger.info(
        `Starting repository clone and validation for ${branch || "main"}`,
        "CLONE"
      );
      socket.emitPipelineStatus(executionId, "running", {
        step: "cloning",
        progress: 20,
      });

      const pipeRes = await PipelineHelper.executePipeline(
        repoUrl,
        repoName,
        branch,
        true
      );
      if (!pipeRes.success || !pipeRes.tempDir) {
        await logger.error(
          `Pipeline validation failed: ${pipeRes.error || "unknown"}`,
          "CLONE"
        );
        throw new Error(pipeRes.error || "Pipeline validation failed");
      }

      await logger.info(
        "Repository cloned and pipeline.yml validated successfully",
        "CLONE"
      );

      const tempDir = pipeRes.tempDir;
      const yamlPath = path.join(tempDir, ".zipline/pipeline.yml");
      if (!existsSync(yamlPath))
        throw new Error("Pipeline configuration not found after cloning");

      await logger.info(
        `Reading pipeline configuration from ${yamlPath}`,
        "DAG_ORCHESTRATOR"
      );
      const pipeline = await PipelineHelper.readYamlConfig(yamlPath);

      await logger.info(
        `Building DAG execution plan for ${pipeline.steps.length} steps`,
        "DAG_ORCHESTRATOR"
      );
      socket.emitPipelineStatus(executionId, "running", {
        step: "planning",
        progress: 40,
      });

      const plan = PipelineOrchestrator.buildExecutionPlan(
        pipeline.steps as StepLike[]
      );
      activePlans.set(executionId, plan);
      await logger.info(
        `DAG plan: ${
          plan.totalSteps
        } steps, initial ready: ${plan.initialSteps.join(", ")}`,
        "DAG_ORCHESTRATOR"
      );

      await logger.info(
        "Setting up parallel scheduler for DAG execution",
        "DAG_ORCHESTRATOR"
      );
      socket.emitPipelineStatus(executionId, "running", {
        step: "execution",
        progress: 50,
      });

      setupParallelScheduler(
        executionId,
        plan,
        tempDir,
        repoName,
        repository,
        logger,
        socket
      );

      socket.emitPipelineStatus(executionId, "running", { step: "executing" });
      await logger.info(
        "DAG execution started with parallel scheduling",
        "DAG_ORCHESTRATOR"
      );

      return { success: true };
    } catch (error: any) {
      await logger.error(
        `DAG orchestrator failed: ${error.message}`,
        "DAG_ORCHESTRATOR"
      );
      socket.emitPipelineStatus(executionId, "failed", {
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
            mode: "DAG",
            failed_at: new Date().toISOString(),
          },
        },
        repository.full_name
      );

      throw error;
    }
  },
  { connection }
);

async function finalize(
  executionId: string,
  plan: DAGExecutionPlan,
  jobData: StepJobData
) {
  const logger = new PipelineLoggerService(executionId);
  await logger.init();
  const socket = SocketService.getInstance();
  const ok = PipelineOrchestrator.isPipelineSuccessful(plan);
  const stats = PipelineOrchestrator.getExecutionStats(plan);

  await logger.info(
    `DAG pipeline completed. Success: ${ok}`,
    "DAG_ORCHESTRATOR"
  );
  await logger.info(
    `Stats: ${stats.completed} completed, ${stats.failed} failed, ${stats.total} total`,
    "DAG_ORCHESTRATOR"
  );

  for (const [stepName, node] of plan.nodes) {
    if (node.status === "completed") {
      const duration =
        node.completedAt && node.startedAt
          ? node.completedAt.getTime() - node.startedAt.getTime()
          : 0;
      await logger.info(
        `Step "${stepName}" completed successfully in ${duration}ms`,
        "SUMMARY"
      );
    } else if (node.status === "failed") {
      await logger.error(
        `Step "${stepName}" failed: ${node.error || "Unknown error"}`,
        "SUMMARY"
      );
    }
  }

  socket.emitPipelineStatus(executionId, "running", {
    step: "finalizing",
    progress: 90,
  });

  const currentRun = await PipelineRunRepository.findByExecutionId(executionId);
  const finishedAt = new Date();
  const durationMs = currentRun?.startedAt
    ? finishedAt.getTime() - currentRun.startedAt.getTime()
    : null;

  await PipelineRunRepository.updateByExecutionId(executionId, {
    status: ok ? "SUCCESS" : "FAILED",
    finishedAt,
    durationMs,
    errorMessage: ok ? undefined : "One or more steps failed",
  }).catch(() => {});

  if (ok) {
    await logger.info(
      "All pipeline steps completed successfully",
      "DAG_ORCHESTRATOR"
    );
  } else {
    await logger.error(
      `Pipeline execution failed: One or more steps failed`,
      "DAG_ORCHESTRATOR"
    );
  }

  socket.emitPipelineStatus(executionId, ok ? "success" : "failed", {
    duration:
      plan.nodes.size > 0
        ? Date.now() - Array.from(plan.nodes.values())[0].queuedAt?.getTime()!
        : 0,
    stepsCompleted: stats.completed,
    totalSteps: stats.total,
    stepsFailed: stats.failed,
    mode: "DAG",
  });

  await logger.info(
    `Final pipeline status emitted: ${ok ? "success" : "failed"}`,
    "DAG_ORCHESTRATOR"
  );

  await ActivityService.addPipelineExecutionActivity(
    {
      type: "pipeline_execution",
      status: ok ? "success" : "failed",
      repository: jobData.repository,
      metadata: {
        executionId,
        steps_completed: stats.completed,
        total_steps: stats.total,
        steps_failed: stats.failed,
        mode: "DAG",
        completed_at: new Date().toISOString(),
      },
    },
    jobData.repository.full_name
  );

  try {
    if (jobData.workingDir && existsSync(jobData.workingDir)) {
      await logger.info(
        `Cleaning up temporary directory: ${jobData.workingDir}`,
        "CLEANUP"
      );
      await execPromise(`sudo rm -rf ${jobData.workingDir}`);
      await logger.info("Temporary directory cleaned up", "CLEANUP");
    }
  } catch (cleanupError) {
    console.warn(
      `[DAG_ORCHESTRATOR] Failed to cleanup temp directory: ${cleanupError}`
    );
    await logger.warn(
      `Failed to cleanup temp directory: ${cleanupError}`,
      "CLEANUP"
    );
  }

  await logger.info("DAG pipeline execution completed", "COMPLETE");

  activePlans.delete(executionId);
  const scheduler = activeSchedulers.get(executionId);
  if (scheduler) {
    scheduler.cleanup();
  }
}

console.log("[DAG_ORCHESTRATOR] DAG pipeline queues and workers initialized");

dagOrchestratorWorker.on("error", (error) => {
  console.error("[DAG_ORCHESTRATOR] Orchestrator worker error:", error);
});

dagOrchestratorWorker.on("failed", async (job, error) => {
  console.error(
    `[DAG_ORCHESTRATOR] Orchestrator job ${job?.id} failed:`,
    error.message
  );

  if (job?.data?.executionId) {
    const executionId = job.data.executionId;
    const currentRun = await PipelineRunRepository.findByExecutionId(
      executionId
    );
    const finishedAt = new Date();
    const durationMs = currentRun?.startedAt
      ? finishedAt.getTime() - currentRun.startedAt.getTime()
      : null;

    await PipelineRunRepository.updateByExecutionId(executionId, {
      status: "FAILED",
      finishedAt,
      durationMs,
      errorMessage: error.message,
    }).catch(() => {});
  }
});

dagOrchestratorWorker.on("completed", (job, result) => {
  console.log(
    `[DAG_ORCHESTRATOR] Orchestrator job ${job.id} completed successfully`
  );
});

dagStepWorker.on("error", (error) => {
  console.error("[DAG_STEP] Step worker error:", error);
});

dagStepWorker.on("failed", (job, error) => {
  console.error(`[DAG_STEP] Step job ${job?.id} failed:`, error.message);
});

dagStepWorker.on("completed", (job, result) => {
  console.log(`[DAG_STEP] Step job ${job.id} completed successfully`);
});

export async function addDAGPipelineJob(
  data: Omit<OrchestratorJobData, "executionId">
): Promise<string> {
  const executionId = `dag-${data.repoName}-${Date.now()}`;
  console.log(
    `[DAG_ORCHESTRATOR] Creating DAG job for ${data.repoName} with execution ID: ${executionId}`
  );

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
  }).catch(() => {});

  const job = await dagOrchestratorQueue.add("orchestrate", {
    ...data,
    executionId,
  });
  console.log(
    `[DAG_ORCHESTRATOR] DAG orchestrator job ${job.id} added to queue for execution ${executionId}`
  );

  await PipelineRunRepository.updateByExecutionId(executionId, {
    jobId: String(job.id),
  }).catch(() => {});
  return executionId;
}

export function cancelDAGExecution(executionId: string): void {
  console.log(`[DAG_CANCEL] Marking execution ${executionId} for cancellation`);
  cancelledExecutions.add(executionId);

  const killedProcesses =
    DockerExecutionService.killProcessesForExecution(executionId);
  console.log(
    `[DAG_CANCEL] Killed ${killedProcesses} Docker processes for execution ${executionId}`
  );

  const scheduler = activeSchedulers.get(executionId);
  if (scheduler) {
    scheduler.cleanup();
    activeSchedulers.delete(executionId);
  }

  activePlans.delete(executionId);
}

export function isExecutionCancelled(executionId: string): boolean {
  return cancelledExecutions.has(executionId);
}

export function cleanupCancelledExecution(executionId: string): void {
  cancelledExecutions.delete(executionId);
}

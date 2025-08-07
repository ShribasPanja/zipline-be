import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PipelineHelper } from "../helpers/pipeline.helper";
import { DockerExecutionService } from "../services/docker.service";
import { ActivityService } from "../services/activity.service";
import { existsSync } from "fs";
import path from "path";

// Redis connection configuration
const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Test Redis connection
connection.on("connect", () => {
  console.log("[QUEUE] Connected to Redis successfully");
});

connection.on("error", (error) => {
  console.error("[QUEUE] Redis connection error:", error.message);
  console.error(
    "[QUEUE] Make sure Redis is running on the configured host/port"
  );
});

// Pipeline job data interface
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
}

// The queue that holds pipeline jobs
export const pipelineQueue = new Queue<PipelineJobData>("pipeline-jobs", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 10, // Keep last 10 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs for debugging
    attempts: 3, // Retry failed jobs up to 3 times
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

// The worker that processes jobs from the queue
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

    try {
      // Update job progress
      await job.updateProgress(10);

      // Log pipeline start activity
      ActivityService.addActivity({
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
      });

      await job.updateProgress(20);

      // Execute the pipeline - this will clone repo and validate pipeline config
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
      ); // Skip cleanup

      if (!pipelineResult.success) {
        throw new Error(pipelineResult.error || "Pipeline validation failed");
      }

      await job.updateProgress(40);

      // Now get the pipeline config and execute steps with Docker
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

        // Execute pipeline steps using Docker
        console.log(
          `[QUEUE] Executing ${pipeline.steps.length} pipeline steps`
        );
        const dockerResult = await DockerExecutionService.executePipelineSteps(
          pipeline.steps,
          tempDir
        );

        await job.updateProgress(90);

        // Combine results
        const finalResult = {
          success: dockerResult.success,
          error: dockerResult.error,
          duration: pipelineResult.duration,
          steps: dockerResult.steps,
        };

        // Log completion activity
        ActivityService.addActivity({
          type: "pipeline_execution",
          status: finalResult.success ? "success" : "failed",
          repository,
          metadata: {
            executionId,
            jobId: job.id,
            duration: `${Math.round(finalResult.duration / 1000)}s`,
            steps_completed: finalResult.steps.filter((s) => s.success).length,
            total_steps: finalResult.steps.length,
            error: finalResult.error || undefined,
            repoUrl,
            branch: branch || "main",
            completed_at: new Date().toISOString(),
          },
        });

        await job.updateProgress(100);

        // Cleanup temp directory
        try {
          if (existsSync(tempDir)) {
            console.log(`[QUEUE] Cleaning up temporary directory: ${tempDir}`);
            const { rm } = await import("fs/promises");
            await rm(tempDir, { recursive: true, force: true });
          }
        } catch (cleanupError) {
          console.warn(
            `[QUEUE] Failed to cleanup temp directory: ${cleanupError}`
          );
        }

        console.log(`[QUEUE] Pipeline job ${job.id} completed successfully`);
        return {
          success: true,
          executionId,
          result: finalResult,
        };
      } else {
        throw new Error("Pipeline configuration not found after cloning");
      }
    } catch (error: any) {
      console.error(`[QUEUE] Pipeline job ${job.id} failed:`, error.message);

      // Log failure activity
      ActivityService.addActivity({
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
      });

      throw error; // Re-throw to mark job as failed
    }
  },
  {
    connection,
    concurrency: 3, // Process up to 3 jobs concurrently
  }
);

// Queue event handlers
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

// Helper function to add a pipeline job to the queue
export async function addPipelineJob(
  data: Omit<PipelineJobData, "executionId">
): Promise<string> {
  const executionId = `${data.repoName}-${Date.now()}`;

  const job = await pipelineQueue.add(
    "execute-pipeline",
    {
      ...data,
      executionId,
    },
    {
      priority: 1, // Higher priority for webhook-triggered pipelines
      delay: 0, // Execute immediately
    }
  );

  console.log(
    `[QUEUE] Added pipeline job ${job.id} for ${data.repoName} (execution: ${executionId})`
  );
  return executionId;
}

// Helper function to get job status
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

import { Request, Response } from "express";
import { getPipelineJobStatus, pipelineQueue } from "../queue/pipeline.queue";

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
}

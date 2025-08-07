import { Router } from "express";
import { QueueController } from "../controllers/queue.controller";

const router = Router();

// Get job status by execution ID
router.get("/jobs/:executionId", QueueController.getJobStatus);

// Get queue statistics
router.get("/stats", QueueController.getQueueStats);

// Get recent jobs
router.get("/jobs", QueueController.getRecentJobs);

export default router;

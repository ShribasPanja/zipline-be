import { Router } from "express";
import { PipelineController } from "../controllers/pipeline.controller";

const router = Router();

// POST /api/pipeline/execute - Execute pipeline for a repository
router.post("/execute", PipelineController.executePipeline);

// GET /api/pipeline/executions/:executionId - Get specific execution status
router.get("/executions/:executionId", PipelineController.getExecutionStatus);

// GET /api/pipeline/executions - Get all executions or filter by repo
router.get("/executions", PipelineController.getExecutions);

// POST /api/pipeline/validate - Validate pipeline configuration
router.post("/validate", PipelineController.validatePipelineConfig);

// GET /api/pipeline/status - Get pipeline system status
router.get("/status", PipelineController.getPipelineStatus);

// POST /api/pipeline/cleanup - Cleanup old executions
router.post("/cleanup", PipelineController.cleanupExecutions);

export default router;

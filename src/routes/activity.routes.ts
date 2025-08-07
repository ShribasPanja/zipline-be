import { Router } from "express";
import { ActivityController } from "../controllers/activity.controller";

const router = Router();

// GET /api/activities - Get activities with filtering
router.get("/", ActivityController.getActivities);

// GET /api/activities/recent - Get recent activities
router.get("/recent", ActivityController.getRecentActivities);

// POST /api/activities/seed - Seed sample activities (for development)
router.post("/seed", ActivityController.seedSampleActivities);

// DELETE /api/activities - Clear all activities (for development)
router.delete("/", ActivityController.clearActivities);

export default router;

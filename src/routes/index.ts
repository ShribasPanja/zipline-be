import { Router } from "express";
import authRoutes from "./auth.routes";
import webhookRoutes from "./webhook.routes";
import repositoryRoutes from "./repository.routes";
import activityRoutes from "./activity.routes";
import pipelineRoutes from "./pipeline.routes";
import queueRoutes from "./queue.routes";

const router = Router();

// Mount routes
router.use("/auth", authRoutes);
router.use("/webhook", webhookRoutes);
router.use("/repositories", repositoryRoutes);
router.use("/activities", activityRoutes);
router.use("/pipeline", pipelineRoutes);
router.use("/queue", queueRoutes);

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;

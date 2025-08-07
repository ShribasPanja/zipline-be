import { Router } from "express";
import { RepositoryController } from "../controllers/repository.controller";

const router = Router();

// Get user repositories
router.get("/", RepositoryController.getUserRepositories);

// Check webhook status for repositories
router.get("/webhook-status", RepositoryController.checkWebhookStatus);

// Setup webhook for a repository
router.post("/setup-webhook", RepositoryController.setupWebhook);

export default router;

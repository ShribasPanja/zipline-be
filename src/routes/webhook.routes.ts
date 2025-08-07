import { Router } from "express";
import { WebhookController } from "../controllers/webhook.controller";

const router = Router();

// GitHub webhook route
router.post("/github", WebhookController.handleGitHubWebhook);

// Webhook validation route
router.post("/validate", WebhookController.validateWebhook);

export default router;

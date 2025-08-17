import { Request, Response, NextFunction } from "express";
import { WebhookService } from "../services/webhook.service";
import { ResponseHelper } from "../helpers/response.helper";
import { GitHubWebhookPayload } from "../types/github.types";

export class WebhookController {
  static async handleGitHubWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const event = req.headers["x-github-event"] as string;
      const signature = req.headers["x-hub-signature-256"] as string;

      if (!event) {
        ResponseHelper.error(res, "Missing GitHub event header", 400);
        return;
      }

      const payload: GitHubWebhookPayload = req.body;

      // Validate payload structure for events we care about
      if (event === "push" && (!payload.repository || !payload.head_commit)) {
        ResponseHelper.error(res, "Invalid webhook payload", 400);
        return;
      }

      // Get webhook secret from environment
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

      try {
        // Process the webhook event with signature validation
        await WebhookService.processWebhookEvent(
          event,
          payload,
          signature,
          webhookSecret
        );

        console.log(
          `[WEBHOOK] Successfully processed ${event} event for ${
            payload.repository?.name || "unknown"
          }`
        );
        ResponseHelper.success(
          res,
          null,
          `${event} event processed successfully`
        );
      } catch (processError: any) {
        console.error(
          `[WEBHOOK] Failed to process ${event} event:`,
          processError
        );

        if (processError.message.includes("signature validation failed")) {
          ResponseHelper.error(res, "Webhook signature validation failed", 401);
        } else {
          ResponseHelper.error(
            res,
            `Failed to process webhook: ${processError.message}`,
            500
          );
        }
        return;
      }
    } catch (error) {
      next(error);
    }
  }

  static async validateWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { repoUrl, secret } = req.body;

      if (!repoUrl) {
        ResponseHelper.error(res, "Repository URL is required", 400);
        return;
      }

      // For now, just return success with webhook setup info
      // In a real implementation, you might verify the repository exists and is accessible
      ResponseHelper.success(
        res,
        {
          webhookUrl: `${req.protocol}://${req.get("host")}/api/webhook/github`,
          events: ["push", "pull_request"],
          contentType: "application/json",
          secret: secret ? "***hidden***" : "not configured",
        },
        "Webhook configuration validated"
      );
    } catch (error: any) {
      console.error("[WEBHOOK] Validation failed:", error);
      ResponseHelper.error(res, error.message || "Internal server error", 500);
    }
  }
}

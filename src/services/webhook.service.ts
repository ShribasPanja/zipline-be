import { GitHubWebhookPayload } from "../types/github.types";
import { PipelineService } from "./pipeline.service";
import { ActivityService } from "./activity.service";
import crypto from "crypto";

export class WebhookService {
  static async handlePushEvent(payload: GitHubWebhookPayload): Promise<void> {
    try {
      const { repository, head_commit, pusher } = payload;

      // Extract branch name from ref (refs/heads/branch-name -> branch-name)
      const branchName = payload.ref.replace("refs/heads/", "");
      console.log(`[INFO] Push event received for repo: ${repository.name}`);
      console.log(`[INFO] Branch: ${branchName}`);
      console.log(`[INFO] Latest commit: "${head_commit.message}"`);
      console.log(`[INFO] Pushed by: ${pusher.name} (${pusher.email})`);
      console.log(`[INFO] Commit ID: ${head_commit.id}`);

      // Get repository owner info to associate activity with the user who set up the webhook
      const { RepositoryOwnerRepository } = await import(
        "../repositories/repositoryOwner.repository"
      );

      const repoOwner = await RepositoryOwnerRepository.findByRepoFullName(
        repository.full_name
      );

      // Log the push activity
      ActivityService.addActivity({
        type: "push",
        repository: {
          name: repository.name,
          full_name: repository.full_name,
        },
        commit: {
          id: head_commit.id,
          message: head_commit.message,
          author: {
            name: head_commit.author.name,
            email: head_commit.author.email,
          },
        },
        pusher: {
          name: pusher.name,
          email: pusher.email,
        },
        user: repoOwner
          ? {
              id: repoOwner.userId,
              login: repoOwner.userLogin,
              name: repoOwner.userName || undefined,
              email: repoOwner.userEmail || undefined,
            }
          : undefined,
        status: "success",
        metadata: {
          ref: payload.ref,
          before: payload.before,
          after: payload.after,
          commits_count: payload.commits?.length || 1,
        },
      }); // Trigger pipeline execution asynchronously
      console.log(
        `[INFO] Triggering pipeline for ${repository.name} (${repository.clone_url}) on branch ${branchName}`
      );

      try {
        // Get repository owner info to associate pipeline with the user who set up the webhook
        const { RepositoryOwnerRepository } = await import(
          "../repositories/repositoryOwner.repository"
        );

        const repoOwner = await RepositoryOwnerRepository.findByRepoFullName(
          repository.full_name
        );

        console.log(
          `[WEBHOOK] Found repository owner: ${repoOwner?.userLogin} (${repoOwner?.userId}) for ${repository.full_name}`
        );

        const executionId = await PipelineService.executePipelineAsync(
          repository.clone_url,
          repository.name,
          branchName,
          {
            name: repository.name,
            full_name: repository.full_name,
          },
          {
            id: head_commit.id,
            message: head_commit.message,
          },
          repoOwner
            ? {
                userId: repoOwner.userId,
                login: repoOwner.userLogin,
                name: head_commit.author.name, // Use commit author name for display
                email: head_commit.author.email, // Use commit author email for display
              }
            : undefined
        );

        console.log(
          `[INFO] Pipeline queued successfully with execution ID: ${executionId}`
        );
      } catch (pipelineError) {
        console.error("[ERROR] Failed to queue pipeline:", pipelineError);
      }
    } catch (error) {
      console.error("[ERROR] Failed to handle push event:", error);
      throw error;
    }
  }

  static validateWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    try {
      if (!signature || !signature.startsWith("sha256=")) {
        console.error("[WEBHOOK] Invalid signature format");
        return false;
      }

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex");

      const actualSignature = signature.slice(7); // Remove 'sha256=' prefix

      // Use crypto.timingSafeEqual to prevent timing attacks
      const expectedBuffer = Buffer.from(expectedSignature, "hex");
      const actualBuffer = Buffer.from(actualSignature, "hex");

      if (expectedBuffer.length !== actualBuffer.length) {
        console.error("[WEBHOOK] Signature length mismatch");
        return false;
      }

      const isValid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);

      if (!isValid) {
        console.error("[WEBHOOK] Signature validation failed");
      } else {
        console.log("[WEBHOOK] Signature validation successful");
      }

      return isValid;
    } catch (error) {
      console.error("[WEBHOOK] Error validating signature:", error);
      return false;
    }
  }

  static async processWebhookEvent(
    eventType: string,
    payload: GitHubWebhookPayload,
    signature?: string,
    secret?: string
  ): Promise<void> {
    try {
      // Validate webhook signature if secret is provided
      if (secret && signature) {
        const payloadString = JSON.stringify(payload);
        const isValid = this.validateWebhookSignature(
          payloadString,
          signature,
          secret
        );

        if (!isValid) {
          throw new Error("Webhook signature validation failed");
        }
      }

      // Process different event types
      switch (eventType) {
        case "push":
          await this.handlePushEvent(payload);
          break;
        case "pull_request":
          console.log(
            "[WEBHOOK] Pull request event received (not implemented)"
          );
          break;
        case "issues":
          console.log("[WEBHOOK] Issues event received (not implemented)");
          break;
        default:
          console.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
      }
    } catch (error) {
      console.error("[WEBHOOK] Error processing webhook event:", error);
      throw error;
    }
  }
}

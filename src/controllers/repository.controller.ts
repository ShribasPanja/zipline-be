import { Request, Response, NextFunction } from "express";
import { GitHubService } from "../services/github.service";
import { ResponseHelper } from "../helpers/response.helper";

export class RepositoryController {
  static async getUserRepositories(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        ResponseHelper.error(
          res,
          "Missing or invalid authorization header",
          401
        );
        return;
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      const repositories = await GitHubService.getUserRepositories(token);
      ResponseHelper.success(
        res,
        repositories,
        "Repositories fetched successfully"
      );
    } catch (error) {
      next(error);
    }
  }

  static async setupWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { repoFullName } = req.body; // e.g., "my-username/my-awesome-app"
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        ResponseHelper.error(
          res,
          "Missing or invalid authorization header",
          401
        );
        return;
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      if (!repoFullName) {
        ResponseHelper.error(res, "Repository name is required", 400);
        return;
      }

      // Get user info to store as repository owner
      const userInfo = await GitHubService.getUserInfo(token);

      const result = await GitHubService.setupWebhook(token, repoFullName);

      // Store repository owner information for future webhook filtering
      const { RepositoryOwnerRepository } = await import(
        "../repositories/repositoryOwner.repository"
      );

      await RepositoryOwnerRepository.upsert(repoFullName, {
        repoFullName,
        userId: userInfo.id.toString(),
        userLogin: userInfo.login,
        userName: userInfo.name || userInfo.login,
        userEmail: userInfo.email,
      });

      console.log(
        `[WEBHOOK_SETUP] Stored repository owner: ${userInfo.login} (${userInfo.id}) for ${repoFullName}`
      );

      // Log webhook setup activity with user information
      const { ActivityService } = await import("../services/activity.service");
      ActivityService.addActivity({
        type: "webhook_setup",
        repository: {
          name: repoFullName.split("/")[1],
          full_name: repoFullName,
        },
        user: {
          id: userInfo.id.toString(),
          login: userInfo.login,
          name: userInfo.name || userInfo.login,
          email: userInfo.email,
        },
        status: "success",
        metadata: {
          webhook_url: `${process.env.NGROK_URL}/webhook/github`,
          events: ["push"],
          webhook_id: result.id,
        },
      });

      ResponseHelper.success(
        res,
        result,
        `Webhook created for ${repoFullName}`
      );
    } catch (error) {
      next(error);
    }
  }

  static async checkWebhookStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        ResponseHelper.error(
          res,
          "Missing or invalid authorization header",
          401
        );
        return;
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Check if specific repository is requested
      const { repoFullName } = req.query;

      if (repoFullName && typeof repoFullName === "string") {
        // Check single repository
        const hasWebhook = await GitHubService.checkWebhookExists(
          token,
          repoFullName
        );
        ResponseHelper.success(
          res,
          { [repoFullName]: hasWebhook },
          `Webhook status checked for ${repoFullName}`
        );
      } else {
        // Get repositories from query params (comma-separated) or fetch all user repos
        const repoNamesParam = req.query.repositories as string;
        let repoNames: string[] = [];

        if (repoNamesParam) {
          repoNames = repoNamesParam.split(",").map((name) => name.trim());
        } else {
          // If no specific repos requested, get all user repositories
          const repositories = await GitHubService.getUserRepositories(token);
          repoNames = repositories.map((repo) => repo.full_name);
        }

        const webhookStatuses = await GitHubService.checkMultipleWebhooks(
          token,
          repoNames
        );
        ResponseHelper.success(
          res,
          webhookStatuses,
          "Webhook statuses checked successfully"
        );
      }
    } catch (error) {
      next(error);
    }
  }
}

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

      const token = authHeader.substring(7);

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
      const { repoFullName } = req.body;
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        ResponseHelper.error(
          res,
          "Missing or invalid authorization header",
          401
        );
        return;
      }

      const token = authHeader.substring(7);

      if (!repoFullName) {
        ResponseHelper.error(res, "Repository name is required", 400);
        return;
      }

      const result = await GitHubService.setupWebhook(token, repoFullName);
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

      const token = authHeader.substring(7);

      const { repoFullName } = req.query;

      if (repoFullName && typeof repoFullName === "string") {
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
        const repoNamesParam = req.query.repositories as string;
        let repoNames: string[] = [];

        if (repoNamesParam) {
          repoNames = repoNamesParam.split(",").map((name) => name.trim());
        } else {
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

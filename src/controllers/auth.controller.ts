import { Request, Response, NextFunction } from "express";
import { GitHubService } from "../services/github.service";
import { ResponseHelper } from "../helpers/response.helper";
import { config } from "../config";

export class AuthController {
  static async redirectToGitHub(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const authUrl = GitHubService.generateAuthUrl();
      ResponseHelper.redirect(res, authUrl);
    } catch (error) {
      next(error);
    }
  }

  static async handleGitHubCallback(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { code } = req.query;

      if (!code || typeof code !== "string") {
        ResponseHelper.redirect(
          res,
          `${config.frontend.url}/login?error=missing_code`
        );
        return;
      }

      const accessToken = await GitHubService.exchangeCodeForToken(code);


      ResponseHelper.redirect(
        res,
        `${config.frontend.url}/dashboard?token=${accessToken}`
      );
    } catch (error) {
      console.error("[ERROR] GitHub auth callback failed:", error);
      ResponseHelper.redirect(
        res,
        `${config.frontend.url}/login?error=auth_failed`
      );
    }
  }
}

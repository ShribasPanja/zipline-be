import { Request, Response, NextFunction } from "express";
import { GitHubService } from "../services/github.service";
import { ResponseHelper } from "../helpers/response.helper";

export class UserController {
  static async getCurrentUser(
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

      const userInfo = await GitHubService.getUserInfo(token);
      ResponseHelper.success(
        res,
        userInfo,
        "User information retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  }
}

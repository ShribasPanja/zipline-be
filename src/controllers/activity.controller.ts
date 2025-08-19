import { Request, Response, NextFunction } from "express";
import { ActivityService } from "../services/activity.service";
import { ResponseHelper } from "../helpers/response.helper";
import { ActivityFilter } from "../types/activity.types";

export class ActivityController {
  static async getActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const filter: ActivityFilter = {
        type: req.query.type as string,
        repository: req.query.repository as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      // Remove undefined values
      Object.keys(filter).forEach((key) => {
        if (filter[key as keyof ActivityFilter] === undefined) {
          delete filter[key as keyof ActivityFilter];
        }
      });

      const activities = ActivityService.getActivities(filter);
      ResponseHelper.success(
        res,
        activities,
        "Activities retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  }

  static async getRecentActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      // Get user info from authentication header to filter activities
      let userId: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
          const token = authHeader.substring(7);
          const { GitHubService } = await import("../services/github.service");
          const userInfo = await GitHubService.getUserInfo(token);
          userId = userInfo.id.toString();
          console.log(
            `[API] Filtering activities for user: ${userInfo.login} (${userId})`
          );
        } catch (error) {
          console.warn(
            "[API] Could not get user info for activity filtering:",
            error
          );
          // Continue without filtering - will show no activities for unauthenticated users
        }
      }

      const activities = ActivityService.getRecentActivities(limit, userId);
      console.log(
        `[API] Found ${activities.length} activities for user ${
          userId || "anonymous"
        }`
      );

      ResponseHelper.success(
        res,
        activities,
        "Recent activities retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  }

  static async clearActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      ActivityService.clearActivities();
      ResponseHelper.success(res, null, "Activities cleared successfully");
    } catch (error) {
      next(error);
    }
  }

  static async seedSampleActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      ActivityService.seedSampleActivities();
      ResponseHelper.success(
        res,
        null,
        "Sample activities seeded successfully"
      );
    } catch (error) {
      next(error);
    }
  }
}

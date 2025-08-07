import { Request, Response, NextFunction } from "express";
import { ResponseHelper } from "../helpers/response.helper";

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error("[ERROR]", error.message);
  console.error("[STACK]", error.stack);

  ResponseHelper.error(res, error.message || "Internal Server Error", 500);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  ResponseHelper.error(res, `Route ${req.originalUrl} not found`, 404);
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
};

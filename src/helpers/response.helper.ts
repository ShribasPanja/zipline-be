import { Response } from "express";
import { ApiResponse, ErrorResponse } from "../types/api.types";

export class ResponseHelper {
  static success<T>(
    res: Response,
    data?: T,
    message?: string,
    statusCode = 200
  ): Response {
    const response: ApiResponse<T> = {
      success: true,
      data,
      message,
    };
    return res.status(statusCode).json(response);
  }

  static error(res: Response, error: string, statusCode = 500): Response {
    const response: ErrorResponse = {
      error,
      statusCode,
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(response);
  }

  static redirect(res: Response, url: string): void {
    res.redirect(url);
  }
}

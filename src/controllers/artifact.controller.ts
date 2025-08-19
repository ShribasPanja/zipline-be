import { Request, Response } from "express";
import { ArtifactService } from "../services/artifact.service";
import { ResponseHelper } from "../helpers/response.helper";

export class ArtifactController {
  private static artifactService = new ArtifactService();

  /**
   * List all artifacts for a pipeline execution
   */
  static async listArtifacts(req: Request, res: Response) {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        return ResponseHelper.error(res, "Execution ID is required", 400);
      }

      const artifacts = await ArtifactController.artifactService.listArtifacts(
        executionId
      );

      return ResponseHelper.success(
        res,
        {
          executionId,
          artifacts,
          total: artifacts.length,
        },
        "Artifacts retrieved successfully"
      );
    } catch (error: any) {
      console.error("[ARTIFACT_CONTROLLER] List artifacts failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Failed to list artifacts",
        500
      );
    }
  }

  /**
   * Get download URL for a specific artifact
   */
  static async getArtifactDownloadUrl(req: Request, res: Response) {
    try {
      const { executionId, stepName, fileName } = req.params;
      const { expiresIn = 3600 } = req.query;

      if (!executionId || !stepName || !fileName) {
        return ResponseHelper.error(
          res,
          "Execution ID, step name, and file name are required",
          400
        );
      }

      // Generate backend download URL instead of direct MinIO URL
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
      const downloadUrl = `${backendUrl}/api/artifacts/${executionId}/${stepName}/${fileName}/stream`;

      return ResponseHelper.success(
        res,
        {
          executionId,
          stepName,
          fileName,
          downloadUrl,
          expiresIn: parseInt(String(expiresIn)),
        },
        "Download URL generated successfully"
      );
    } catch (error: any) {
      console.error("[ARTIFACT_CONTROLLER] Get download URL failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Failed to generate download URL",
        500
      );
    }
  }

  /**
   * Stream artifact directly from storage
   */
  static async streamArtifact(req: Request, res: Response) {
    try {
      const { executionId, stepName, fileName } = req.params;

      if (!executionId || !stepName || !fileName) {
        return ResponseHelper.error(
          res,
          "Execution ID, step name, and file name are required",
          400
        );
      }

      const key = `${executionId}/${stepName}/${fileName}`;

      // Stream the artifact through the backend
      await ArtifactController.artifactService.streamArtifact(key, res);
    } catch (error: any) {
      console.error("[ARTIFACT_CONTROLLER] Stream artifact failed:", error);
      if (!res.headersSent) {
        return ResponseHelper.error(
          res,
          error.message || "Failed to stream artifact",
          500
        );
      }
    }
  }

  /**
   * Get artifacts for all executions (admin endpoint)
   */
  static async getAllArtifacts(req: Request, res: Response) {
    try {
      const { limit = 50, offset = 0 } = req.query;

      return ResponseHelper.success(
        res,
        {
          artifacts: [],
          total: 0,
          limit: parseInt(String(limit)),
          offset: parseInt(String(offset)),
          message:
            "Use /artifacts/:executionId to get artifacts for a specific execution",
        },
        "Use execution-specific endpoint for artifacts"
      );
    } catch (error: any) {
      console.error("[ARTIFACT_CONTROLLER] Get all artifacts failed:", error);
      return ResponseHelper.error(
        res,
        error.message || "Failed to get artifacts",
        500
      );
    }
  }

  /**
   * Get artifact metadata
   */
  static async getArtifactMetadata(req: Request, res: Response) {
    try {
      const { executionId, stepName, fileName } = req.params;

      if (!executionId || !stepName || !fileName) {
        return ResponseHelper.error(
          res,
          "Execution ID, step name, and file name are required",
          400
        );
      }

      const artifacts = await ArtifactController.artifactService.listArtifacts(
        executionId
      );
      const artifact = artifacts.find(
        (a) => a.stepName === stepName && a.fileName === fileName
      );

      if (!artifact) {
        return ResponseHelper.error(res, "Artifact not found", 404);
      }

      return ResponseHelper.success(
        res,
        artifact,
        "Artifact metadata retrieved successfully"
      );
    } catch (error: any) {
      console.error(
        "[ARTIFACT_CONTROLLER] Get artifact metadata failed:",
        error
      );
      return ResponseHelper.error(
        res,
        error.message || "Failed to get artifact metadata",
        500
      );
    }
  }
}

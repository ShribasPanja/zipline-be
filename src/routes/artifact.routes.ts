import { Router } from "express";
import { ArtifactController } from "../controllers/artifact.controller";

const router = Router();

/**
 * @route GET /api/artifacts
 * @desc Get all artifacts (admin endpoint)
 * @access Public (should be protected in production)
 */
router.get("/", ArtifactController.getAllArtifacts);

/**
 * @route GET /api/artifacts/:executionId
 * @desc List all artifacts for a specific pipeline execution
 * @access Public (should be protected in production)
 */
router.get("/:executionId", ArtifactController.listArtifacts);

/**
 * @route GET /api/artifacts/:executionId/:stepName/:fileName/download
 * @desc Get download URL for a specific artifact
 * @access Public (should be protected in production)
 */
router.get(
  "/:executionId/:stepName/:fileName/download",
  ArtifactController.getArtifactDownloadUrl
);

/**
 * @route GET /api/artifacts/:executionId/:stepName/:fileName/stream
 * @desc Stream artifact directly through backend
 * @access Public (should be protected in production)
 */
router.get(
  "/:executionId/:stepName/:fileName/stream",
  ArtifactController.streamArtifact
);

/**
 * @route GET /api/artifacts/:executionId/:stepName/:fileName/metadata
 * @desc Get metadata for a specific artifact
 * @access Public (should be protected in production)
 */
router.get(
  "/:executionId/:stepName/:fileName/metadata",
  ArtifactController.getArtifactMetadata
);

export default router;

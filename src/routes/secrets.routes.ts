import { Router } from "express";
import { SecretsController } from "../controllers/secrets.controller";

const router = Router();

// Get all secret keys for a repository (without values)
router.get(
  "/repositories/:repoFullName/secrets",
  SecretsController.getSecretKeys
);

// Create or update a single secret
router.post(
  "/repositories/:repoFullName/secrets",
  SecretsController.saveSecret
);

// Bulk update secrets for a repository
router.put(
  "/repositories/:repoFullName/secrets",
  SecretsController.bulkUpdateSecrets
);

// Delete a specific secret
router.delete(
  "/repositories/:repoFullName/secrets/:key",
  SecretsController.deleteSecret
);

// Validate secret key format
router.post("/secrets/validate-key", SecretsController.validateSecretKey);

export default router;

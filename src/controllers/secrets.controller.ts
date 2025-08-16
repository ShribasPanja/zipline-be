import { Request, Response } from "express";
import { SecretsService } from "../services/secrets.service";

export class SecretsController {
  /**
   * Get all secret keys for a repository (without values)
   */
  static async getSecretKeys(req: Request, res: Response) {
    try {
      const { repoFullName } = req.params;

      if (!repoFullName) {
        return res
          .status(400)
          .json({ error: "Repository full name is required" });
      }

      const secrets = await SecretsService.getSecretKeysForRepository(
        repoFullName
      );

      res.json({
        success: true,
        data: secrets,
      });
    } catch (error: any) {
      console.error("Error fetching secret keys:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch secret keys",
      });
    }
  }

  /**
   * Create or update a secret
   */
  static async saveSecret(req: Request, res: Response) {
    try {
      const { repoFullName } = req.params;
      const { key, value } = req.body;

      if (!repoFullName) {
        return res
          .status(400)
          .json({ error: "Repository full name is required" });
      }

      if (!key || !value) {
        return res.status(400).json({ error: "Key and value are required" });
      }

      if (!SecretsService.validateSecretKey(key)) {
        return res.status(400).json({
          error:
            "Invalid secret key format. Must be uppercase letters, numbers, and underscores only (e.g., NPM_TOKEN, AWS_ACCESS_KEY_ID)",
        });
      }

      const secret = await SecretsService.saveSecret(repoFullName, key, value);

      res.json({
        success: true,
        data: {
          key: secret.key,
          createdAt: secret.createdAt,
          updatedAt: secret.updatedAt,
        },
        message: "Secret saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving secret:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save secret",
      });
    }
  }

  /**
   * Bulk update secrets for a repository
   */
  static async bulkUpdateSecrets(req: Request, res: Response) {
    try {
      const { repoFullName } = req.params;
      const { secrets } = req.body;

      if (!repoFullName) {
        return res
          .status(400)
          .json({ error: "Repository full name is required" });
      }

      if (!Array.isArray(secrets)) {
        return res.status(400).json({ error: "Secrets must be an array" });
      }

      for (const secret of secrets) {
        if (!secret.key || !secret.value) {
          return res
            .status(400)
            .json({ error: "Each secret must have a key and value" });
        }
        if (!SecretsService.validateSecretKey(secret.key)) {
          return res.status(400).json({
            error: `Invalid secret key format: ${secret.key}. Must be uppercase letters, numbers, and underscores only`,
          });
        }
      }

      const savedSecrets = await SecretsService.bulkUpdateSecrets(
        repoFullName,
        secrets
      );

      res.json({
        success: true,
        data: savedSecrets.map((s) => ({
          key: s.key,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        message: `${savedSecrets.length} secrets saved successfully`,
      });
    } catch (error: any) {
      console.error("Error bulk updating secrets:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to update secrets",
      });
    }
  }

  /**
   * Delete a secret
   */
  static async deleteSecret(req: Request, res: Response) {
    try {
      const { repoFullName, key } = req.params;

      if (!repoFullName || !key) {
        return res
          .status(400)
          .json({ error: "Repository full name and key are required" });
      }

      const success = await SecretsService.deleteSecret(repoFullName, key);

      if (success) {
        res.json({
          success: true,
          message: "Secret deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          error: "Secret not found",
        });
      }
    } catch (error: any) {
      console.error("Error deleting secret:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete secret",
      });
    }
  }

  /**
   * Test endpoint to validate secret key format
   */
  static async validateSecretKey(req: Request, res: Response) {
    try {
      const { key } = req.body;

      if (!key) {
        return res.status(400).json({ error: "Key is required" });
      }

      const isValid = SecretsService.validateSecretKey(key);

      res.json({
        success: true,
        data: {
          key,
          isValid,
          message: isValid
            ? "Valid secret key format"
            : "Invalid secret key format. Must be uppercase letters, numbers, and underscores only",
        },
      });
    } catch (error: any) {
      console.error("Error validating secret key:", error);
      res.status(500).json({
        success: false,
        error: "Failed to validate secret key",
      });
    }
  }
}

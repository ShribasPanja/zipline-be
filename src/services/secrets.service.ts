import CryptoJS from "crypto-js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface RepositorySecret {
  id?: string;
  repoFullName: string;
  key: string;
  value: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DecryptedSecret {
  key: string;
  value: string;
}

export class SecretsService {
  private static readonly ENCRYPTION_KEY =
    process.env.SECRETS_ENCRYPTION_KEY || "default-key-change-in-production";
  private static readonly SECRET_PLACEHOLDER = "***";

  /**
   * Encrypt a secret value using AES encryption
   */
  private static encrypt(value: string): string {
    return CryptoJS.AES.encrypt(value, this.ENCRYPTION_KEY).toString();
  }

  /**
   * Decrypt a secret value
   */
  private static decrypt(encryptedValue: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedValue, this.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  /**
   * Save or update a secret for a repository
   */
  static async saveSecret(
    repoFullName: string,
    key: string,
    value: string
  ): Promise<RepositorySecret> {
    const encryptedValue = this.encrypt(value);

    const existingSecret = await prisma.repositorySecret.findFirst({
      where: {
        repoFullName,
        key,
      },
    });

    if (existingSecret) {
      const updated = await prisma.repositorySecret.update({
        where: { id: existingSecret.id },
        data: {
          value: encryptedValue,
          updatedAt: new Date(),
        },
      });
      return {
        id: updated.id,
        repoFullName: updated.repoFullName,
        key: updated.key,
        value: value,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    } else {
      const created = await prisma.repositorySecret.create({
        data: {
          repoFullName,
          key,
          value: encryptedValue,
        },
      });
      return {
        id: created.id,
        repoFullName: created.repoFullName,
        key: created.key,
        value: value,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    }
  }

  /**
   * Get all secrets for a repository (with decrypted values)
   */
  static async getSecretsForRepository(
    repoFullName: string
  ): Promise<DecryptedSecret[]> {
    const secrets = await prisma.repositorySecret.findMany({
      where: { repoFullName },
      orderBy: { key: "asc" },
    });

    return secrets.map((secret) => ({
      key: secret.key,
      value: this.decrypt(secret.value),
    }));
  }

  /**
   * Get all secret keys for a repository (without values) - for UI display
   */
  static async getSecretKeysForRepository(
    repoFullName: string
  ): Promise<{ key: string; createdAt: Date; updatedAt: Date }[]> {
    const secrets = await prisma.repositorySecret.findMany({
      where: { repoFullName },
      select: {
        key: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { key: "asc" },
    });

    return secrets;
  }

  /**
   * Delete a secret
   */
  static async deleteSecret(
    repoFullName: string,
    key: string
  ): Promise<boolean> {
    try {
      await prisma.repositorySecret.deleteMany({
        where: {
          repoFullName,
          key,
        },
      });
      return true;
    } catch (error) {
      console.error("Error deleting secret:", error);
      return false;
    }
  }

  /**
   * Convert secrets to environment variables format for Docker
   */
  static secretsToEnvVars(secrets: DecryptedSecret[]): string[] {
    return secrets.map((secret) => `${secret.key}=${secret.value}`);
  }

  /**
   * Sanitize log content by replacing secret values with placeholders
   */
  static sanitizeLogContent(
    content: string,
    secrets: DecryptedSecret[]
  ): string {
    let sanitized = content;

    for (const secret of secrets) {
      if (secret.value && secret.value.length > 0) {
        const regex = new RegExp(this.escapeRegExp(secret.value), "g");
        sanitized = sanitized.replace(regex, this.SECRET_PLACEHOLDER);
      }
    }

    return sanitized;
  }

  /**
   * Escape special regex characters in a string
   */
  private static escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Get secrets formatted for Docker environment injection
   */
  static async getDockerEnvVarsForRepository(
    repoFullName: string
  ): Promise<string[]> {
    const secrets = await this.getSecretsForRepository(repoFullName);
    return this.secretsToEnvVars(secrets);
  }

  /**
   * Validate secret key format (alphanumeric and underscores only)
   */
  static validateSecretKey(key: string): boolean {
    const validKeyRegex = /^[A-Z_][A-Z0-9_]*$/;
    return validKeyRegex.test(key);
  }

  /**
   * Bulk update secrets for a repository
   */
  static async bulkUpdateSecrets(
    repoFullName: string,
    secrets: { key: string; value: string }[]
  ): Promise<RepositorySecret[]> {
    const results: RepositorySecret[] = [];

    for (const secret of secrets) {
      if (!this.validateSecretKey(secret.key)) {
        throw new Error(
          `Invalid secret key format: ${secret.key}. Must be uppercase letters, numbers, and underscores only.`
        );
      }

      const saved = await this.saveSecret(
        repoFullName,
        secret.key,
        secret.value
      );
      results.push(saved);
    }

    return results;
  }
}

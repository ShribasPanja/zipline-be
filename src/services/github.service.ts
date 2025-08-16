import axios from "axios";
import { config } from "../config";
import { GitHubTokenResponse } from "../types/github.types";
import { ActivityService } from "./activity.service";

export class GitHubService {
  static generateAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: config.github.clientId,
    });

    return `${config.github.authUrl}?${params.toString()}&scope=repo`;
  }

  static async exchangeCodeForToken(code: string): Promise<string> {
    try {
      const response = await axios.post<GitHubTokenResponse>(
        config.github.tokenUrl,
        {
          client_id: config.github.clientId,
          client_secret: config.github.clientSecret,
          code,
        },
        {
          headers: { Accept: "application/json" },
        }
      );

      const accessToken = response.data.access_token;

      if (!accessToken) {
        throw new Error("No access token received from GitHub");
      }

      return accessToken;
    } catch (error) {
      console.error("[ERROR] Failed to exchange code for token:", error);
      throw new Error("Failed to authenticate with GitHub");
    }
  }

  static async getUserInfo(accessToken: string): Promise<any> {
    try {
      const response = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      return response.data;
    } catch (error) {
      console.error("[ERROR] Failed to fetch user info:", error);
      throw new Error("Failed to fetch user information");
    }
  }

  static async getUserRepositories(accessToken: string): Promise<any[]> {
    try {
      const response = await axios.get("https://api.github.com/user/repos", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        params: {
          sort: "updated",
          per_page: 50,
          type: "all",
        },
      });

      return response.data;
    } catch (error) {
      console.error("[ERROR] Failed to fetch repositories:", error);
      throw new Error("Failed to fetch repositories");
    }
  }

  static async getRepositoryWebhooks(
    accessToken: string,
    repoFullName: string
  ): Promise<any[]> {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${repoFullName}/hooks`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error(
        `[ERROR] Failed to fetch webhooks for ${repoFullName}:`,
        error
      );
      return [];
    }
  }

  static async checkWebhookExists(
    accessToken: string,
    repoFullName: string,
    webhookUrl?: string
  ): Promise<boolean> {
    try {
      const webhooks = await this.getRepositoryWebhooks(
        accessToken,
        repoFullName
      );

      if (webhookUrl) {
        return webhooks.some(
          (hook) => hook.active && hook.config?.url === webhookUrl
        );
      } else {
        return webhooks.some((hook) => hook.active);
      }
    } catch (error) {
      console.error(
        `[ERROR] Failed to check webhook existence for ${repoFullName}:`,
        error
      );
      return false;
    }
  }

  static async checkMultipleWebhooks(
    accessToken: string,
    repoFullNames: string[]
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    const batchSize = 5;
    for (let i = 0; i < repoFullNames.length; i += batchSize) {
      const batch = repoFullNames.slice(i, i + batchSize);
      const batchPromises = batch.map(async (repoFullName) => {
        const hasWebhook = await this.checkWebhookExists(
          accessToken,
          repoFullName
        );
        return { repoFullName, hasWebhook };
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(({ repoFullName, hasWebhook }) => {
        results[repoFullName] = hasWebhook;
      });
    }

    return results;
  }

  static async setupWebhook(
    accessToken: string,
    repoFullName: string
  ): Promise<any> {
    try {
      const hookUrl = `${process.env.NGROK_URL}/webhook/github`;

      const response = await axios.post(
        `https://api.github.com/repos/${repoFullName}/hooks`,
        {
          name: "web",
          active: true,
          events: ["push"],
          config: {
            url: hookUrl,
            content_type: "json",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      console.log(`[INFO] Successfully created webhook for ${repoFullName}`);

      ActivityService.addActivity({
        type: "webhook_setup",
        repository: {
          name: repoFullName.split("/")[1],
          full_name: repoFullName,
        },
        status: "success",
        metadata: {
          webhook_url: hookUrl,
          events: ["push"],
          webhook_id: response.data.id,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error(
        `[ERROR] Failed to create webhook:`,
        error.response?.data || error.message
      );

      if (error.response?.status === 422) {
        throw new Error("Webhook already exists or repository access denied");
      } else if (error.response?.status === 404) {
        throw new Error("Repository not found or insufficient permissions");
      } else if (error.response?.status === 403) {
        throw new Error("Insufficient permissions to create webhook");
      } else {
        throw new Error("Failed to create webhook");
      }
    }
  }
}

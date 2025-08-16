import "dotenv/config";

export const config = {
  port: process.env.PORT || 3001,
  github: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
  },
  frontend: {
    url: process.env.FRONTEND_URL || "http://localhost:3000",
  },
  webhook: {
    url: process.env.WEBHOOK_URL || "http://localhost:3001/webhook/github",
  },
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  },
};

const requiredEnvVars = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

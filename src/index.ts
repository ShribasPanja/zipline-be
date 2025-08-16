import App from "./app";
import "./queue/dag-pipeline.queue";
import { ArtifactService } from "./services/artifact.service";

async function initializeServices() {
  const maxRetries = 5;
  const retryDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[INFO] Initializing artifact service (attempt ${attempt}/${maxRetries})...`
      );
      const artifactService = new ArtifactService();
      await artifactService.initializeBucket();
      console.log("[INFO] Artifact service initialized successfully");
      return;
    } catch (error: any) {
      console.error(
        `[ERROR] Failed to initialize artifact service (attempt ${attempt}/${maxRetries}):`
      );

      if (error) {
        console.error("Error object keys:", Object.keys(error));
        console.error("Error string representation:", String(error));
        console.error(
          "Error JSON (safe):",
          JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
        );

        if (error.message) {
          console.error("Error message:", error.message);
        }
        if (error.code) {
          console.error("Error code:", error.code);
        }
        if (error.name) {
          console.error("Error name:", error.name);
        }
        if (error.errno) {
          console.error("Error errno:", error.errno);
        }
        if (error.syscall) {
          console.error("Error syscall:", error.syscall);
        }
        if (error.hostname) {
          console.error("Error hostname:", error.hostname);
        }
        if (error.address) {
          console.error("Error address:", error.address);
        }
        if (error.port) {
          console.error("Error port:", error.port);
        }
      } else {
        console.error("Error is null or undefined");
      }

      if (attempt < maxRetries) {
        console.log(`[INFO] Retrying in ${retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } else {
        console.error(
          "[ERROR] Max retries reached. Artifact service initialization failed."
        );
        if (error.stack) {
          console.error("Stack trace:", error.stack);
        }
      }
    }
  }
}

const app = new App();
app.listen();

initializeServices();

process.on("SIGTERM", async () => {
  console.log("[INFO] SIGTERM received, shutting down gracefully");
  const {
    dagStepWorker,
    dagOrchestratorWorker,
    dagStepQueue,
    dagOrchestratorQueue,
  } = await import("./queue/dag-pipeline.queue");
  await dagStepWorker.close();
  await dagOrchestratorWorker.close();
  await dagStepQueue.close();
  await dagOrchestratorQueue.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[INFO] SIGINT received, shutting down gracefully");
  const {
    dagStepWorker,
    dagOrchestratorWorker,
    dagStepQueue,
    dagOrchestratorQueue,
  } = await import("./queue/dag-pipeline.queue");
  await dagStepWorker.close();
  await dagOrchestratorWorker.close();
  await dagStepQueue.close();
  await dagOrchestratorQueue.close();
  process.exit(0);
});

import App from "./app";
import "./queue/dag-pipeline.queue"; // Initialize DAG workers only
import { ArtifactService } from "./services/artifact.service";

// Initialize artifact service
async function initializeServices() {
  try {
    const artifactService = new ArtifactService();
    await artifactService.initializeBucket();
    console.log("[INFO] Artifact service initialized successfully");
  } catch (error: any) {
    console.error(
      "[ERROR] Failed to initialize artifact service:",
      error.message
    );
    // Don't exit, continue without artifact service
  }
}

// Start the application
const app = new App();
app.listen();

// Initialize services after app starts
initializeServices();

// Graceful shutdown for DAG workers
process.on("SIGTERM", async () => {
  console.log("[INFO] SIGTERM received, shutting down gracefully");
  // Import dynamically to avoid circular dependency issues
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
  // Import dynamically to avoid circular dependency issues
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

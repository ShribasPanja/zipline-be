import App from "./app";
import "./queue/dag-pipeline.queue"; // Initialize DAG workers only

// Start the application
const app = new App();
app.listen();

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

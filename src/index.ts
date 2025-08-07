import App from "./app";
import "./queue/pipeline.queue"; // Initialize the queue worker

// Start the application
const app = new App();
app.listen();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[INFO] SIGTERM received, shutting down gracefully");
  // Import dynamically to avoid circular dependency issues
  const { pipelineWorker, pipelineQueue } = await import(
    "./queue/pipeline.queue"
  );
  await pipelineWorker.close();
  await pipelineQueue.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[INFO] SIGINT received, shutting down gracefully");
  // Import dynamically to avoid circular dependency issues
  const { pipelineWorker, pipelineQueue } = await import(
    "./queue/pipeline.queue"
  );
  await pipelineWorker.close();
  await pipelineQueue.close();
  process.exit(0);
});

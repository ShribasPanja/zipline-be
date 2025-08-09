import { PipelineLogRepository } from "../repositories/pipelineLog.repository";
import { PipelineRunRepository } from "../repositories/pipelineRun.repository";
import { DbService } from "./db.service";
import SocketService from "./socket.service";

export class PipelineLoggerService {
  private runId?: string;
  private socketService: SocketService;

  constructor(private executionId: string) {
    this.socketService = SocketService.getInstance();
  }

  async init() {
    console.log(
      `[LOGGER] Initializing logger for execution ID: ${this.executionId}`
    );

    if (!DbService.isEnabled()) {
      console.log("[LOGGER] Database not enabled, using console logging only");
      return;
    }

    try {
      const run = await PipelineRunRepository.findByExecutionId(
        this.executionId
      );
      if (run) {
        this.runId = run.id;
        console.log(
          `[LOGGER] Successfully initialized with run ID: ${this.runId}`
        );
      } else {
        console.warn(
          `[LOGGER] No pipeline run found for execution ID: ${this.executionId}`
        );
      }
    } catch (error) {
      console.warn("[LOGGER] Failed to initialize logger:", error);
    }
  }

  async log(
    message: string,
    level: "info" | "warn" | "error" = "info",
    step?: string
  ) {
    const logMessage = `[${level.toUpperCase()}] ${
      step ? `[${step}] ` : ""
    }${message}`;

    // Always log to console first
    console.log(logMessage);

    let savedLog: any = null;

    if (this.runId && DbService.isEnabled()) {
      try {
        console.log(
          `[LOGGER] Attempting to save log to database with runId: ${this.runId}`
        );
        savedLog = await PipelineLogRepository.create({
          runId: this.runId,
          level,
          message,
          step,
        });
        console.log(
          `[LOGGER] Successfully saved log to database: ${savedLog?.id}`
        );
      } catch (error) {
        console.warn("[LOGGER] Failed to store log:", error);
      }
    } else {
      console.log(
        `[LOGGER] Not saving to DB - runId: ${
          this.runId
        }, dbEnabled: ${DbService.isEnabled()}`
      );
    }

    // Emit real-time log via Socket.IO
    try {
      const logData = {
        id: savedLog?.id || `temp-${Date.now()}`,
        level,
        message,
        step,
        timestamp: new Date().toISOString(),
      };

      this.socketService.emitPipelineLog(this.executionId, logData);
      console.log(
        `[LOGGER] Emitted real-time log for execution: ${this.executionId}`
      );
    } catch (error) {
      console.warn("[LOGGER] Failed to emit real-time log:", error);
    }
  }

  async info(message: string, step?: string) {
    return this.log(message, "info", step);
  }

  async warn(message: string, step?: string) {
    return this.log(message, "warn", step);
  }

  async error(message: string, step?: string) {
    return this.log(message, "error", step);
  }
}

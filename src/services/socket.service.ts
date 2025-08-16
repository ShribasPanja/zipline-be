import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { config } from "../config";

export class SocketService {
  private static instance: SocketService;
  private io: SocketIOServer | null = null;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public initialize(httpServer: HttpServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: config.cors.origin,
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });

    this.setupEventHandlers();
    console.log("[SOCKET] Socket.IO server initialized");
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on("connection", (socket) => {
      console.log(`[SOCKET] Client connected: ${socket.id}`);

      socket.on("join-pipeline", (executionId: string) => {
        socket.join(`pipeline-${executionId}`);
        console.log(
          `[SOCKET] Client ${socket.id} joined pipeline-${executionId}`
        );

        socket.emit("joined-pipeline", { executionId });
      });

      socket.on("leave-pipeline", (executionId: string) => {
        socket.leave(`pipeline-${executionId}`);
        console.log(
          `[SOCKET] Client ${socket.id} left pipeline-${executionId}`
        );
      });

      socket.on("disconnect", (reason) => {
        console.log(
          `[SOCKET] Client disconnected: ${socket.id}, reason: ${reason}`
        );
      });
    });
  }

  public emitPipelineLog(
    executionId: string,
    logData: {
      id: string;
      level: "info" | "warn" | "error";
      message: string;
      step?: string;
      timestamp: string;
    }
  ): void {
    if (!this.io) {
      console.warn("[SOCKET] Socket.IO not initialized, cannot emit log");
      return;
    }

    const room = `pipeline-${executionId}`;
    this.io.to(room).emit("pipeline-log", logData);
    console.log(`[SOCKET] Emitted log to room ${room}: ${logData.message}`);
  }

  public emitPipelineStatus(
    executionId: string,
    status: "pending" | "running" | "success" | "failed",
    metadata?: any
  ): void {
    if (!this.io) {
      console.warn("[SOCKET] Socket.IO not initialized, cannot emit status");
      return;
    }

    const room = `pipeline-${executionId}`;
    this.io.to(room).emit("pipeline-status", {
      status,
      metadata,
      timestamp: new Date().toISOString(),
    });
    console.log(`[SOCKET] Emitted status to room ${room}: ${status}`);
  }

  public emitStepStatus(
    executionId: string,
    stepName: string,
    status: "pending" | "running" | "success" | "failed",
    metadata?: {
      startTime?: string;
      endTime?: string;
      duration?: number;
      error?: string;
    }
  ): void {
    if (!this.io) {
      console.warn(
        "[SOCKET] Socket.IO not initialized, cannot emit step status"
      );
      return;
    }

    const room = `pipeline-${executionId}`;
    this.io.to(room).emit("step-status", {
      stepName,
      status,
      metadata,
      timestamp: new Date().toISOString(),
    });
    console.log(
      `[SOCKET] Emitted step status to room ${room}: ${stepName} -> ${status}`
    );
  }

  public emitDAGUpdate(
    executionId: string,
    dagData: {
      nodes: any[];
      edges: any[];
      stepStatuses: { [stepName: string]: any };
    }
  ): void {
    if (!this.io) {
      console.warn(
        "[SOCKET] Socket.IO not initialized, cannot emit DAG update"
      );
      return;
    }

    const room = `pipeline-${executionId}`;
    this.io.to(room).emit("dag-update", {
      ...dagData,
      timestamp: new Date().toISOString(),
    });
    console.log(`[SOCKET] Emitted DAG update to room ${room}`);
  }

  public getIO(): SocketIOServer | null {
    return this.io;
  }

  public async getRoomClientCount(executionId: string): Promise<number> {
    if (!this.io) return 0;

    const room = `pipeline-${executionId}`;
    const sockets = await this.io.in(room).fetchSockets();
    return sockets.length;
  }
}

export default SocketService;

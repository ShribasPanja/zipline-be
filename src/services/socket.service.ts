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

      // Join pipeline execution room
      socket.on("join-pipeline", (executionId: string) => {
        socket.join(`pipeline-${executionId}`);
        console.log(
          `[SOCKET] Client ${socket.id} joined pipeline-${executionId}`
        );

        // Send confirmation
        socket.emit("joined-pipeline", { executionId });
      });

      // Leave pipeline execution room
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

  // Emit pipeline log to all clients watching a specific execution
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

  // Emit pipeline status update
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
    this.io
      .to(room)
      .emit("pipeline-status", {
        status,
        metadata,
        timestamp: new Date().toISOString(),
      });
    console.log(`[SOCKET] Emitted status to room ${room}: ${status}`);
  }

  // Get Socket.IO instance
  public getIO(): SocketIOServer | null {
    return this.io;
  }

  // Get number of clients in a pipeline room
  public async getRoomClientCount(executionId: string): Promise<number> {
    if (!this.io) return 0;

    const room = `pipeline-${executionId}`;
    const sockets = await this.io.in(room).fetchSockets();
    return sockets.length;
  }
}

export default SocketService;

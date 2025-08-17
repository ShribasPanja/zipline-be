import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "./config";
import routes from "./routes";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware";
import SocketService from "./services/socket.service";

class App {
  public app: express.Application;
  public server: any;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
    this.initializeSocket();
  }

  private initializeMiddleware(): void {
    // Request logging
    this.app.use(requestLogger);

    // CORS configuration
    this.app.use(cors(config.cors));

    // Body parsing middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private initializeRoutes(): void {
    // Mount API routes
    this.app.use("/api", routes);
    this.app.use("/", routes); // Also mount routes at root for backward compatibility

    // Root endpoint
    this.app.get("/", (req, res) => {
      res.json({
        message: "Zipline Backend API",
        version: "1.0.0",
        endpoints: {
          auth: "/auth/github",
          webhook: "/webhook/github",
          health: "/health",
        },
      });
    });
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);
  }

  private initializeSocket(): void {
    // Initialize Socket.IO
    const socketService = SocketService.getInstance();
    socketService.initialize(this.server);
  }

  public listen(): void {
    this.server.listen(config.port, () => {
      console.log(
        `[INFO] Backend server listening on http://localhost:${config.port}`
      );
      console.log(
        `[INFO] Environment: ${process.env.NODE_ENV || "development"}`
      );
    });
  }
}

export default App;

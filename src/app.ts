import express from "express";
import cors from "cors";
import { config } from "./config";
import routes from "./routes";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware";

class App {
  public app: express.Application;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
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

  public listen(): void {
    this.app.listen(config.port, () => {
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

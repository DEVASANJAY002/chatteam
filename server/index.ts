import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { testDatabaseConnection } from "./db";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request logger with response preview
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Test DB connection
  try {
    const dbConnected = await testDatabaseConnection();
    if (dbConnected) {
      log("Database connection test successful");
    } else {
      console.error("❌ Failed to connect to database. Check your DATABASE_URL in .env");
      console.error("Current DATABASE_URL: " + (process.env.DATABASE_URL?.replace(/:.+@/, ":****@") || "not set"));
      console.warn("Starting server anyway — some features may not work.");
    }
  } catch (error) {
    console.error("Error testing database connection:", error);
  }

  // Register routes and return the HTTP server (for WebSocket use too)
  const server = await registerRoutes(app);

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Dev/Prod mode Vite or static
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Port and host setup
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "127.0.0.1";

  // ✅ Windows-safe listen block
  server.listen(port, host, () => {
    log(`🚀 Server running in ${process.env.NODE_ENV || "development"} mode`);
    log(`📡 Listening on http://${host}:${port}`);
    if (process.env.DATABASE_URL) {
      log(`🔗 Connected DB: ${process.env.DATABASE_URL.replace(/:.+@/, ":****@")}`);
    } else {
      log("⚠️ No DATABASE_URL found in .env");
    }
  });

  // Prevent crashing from unhandled errors
  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  });
})();

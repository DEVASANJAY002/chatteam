import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { testDatabaseConnection } from "./db";
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
  // Test database connection before starting the server
  try {
    const dbConnected = await testDatabaseConnection();
    if (dbConnected) {
      log("Database connection test successful");
    } else {
      console.error("Failed to connect to database. Please check your DATABASE_URL in .env file.");
      console.error("Current DATABASE_URL: " + (process.env.DATABASE_URL?.replace(/:.+@/, ":****@") || 'not set')); // Hide password in logs
      // Continue anyway as the app might work with some features without DB
      console.warn("Starting server without database connection. Some features may not work.");
    }
  } catch (error) {
    console.error("Error testing database connection:", error);
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Get PORT from environment variables with fallback to 5000
  const port = parseInt(process.env.PORT || "5000", 10);
  
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`Server running in ${process.env.NODE_ENV || 'development'} mode`);
    log(`Serving on port ${port}`);
    if (process.env.DATABASE_URL) {
      log(`Using database: ${process.env.DATABASE_URL.replace(/:.+@/, ":****@")}`); // Hide password in logs
    } else {
      log("No DATABASE_URL found in environment");
    }
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit the process as it would kill the server
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process as it would kill the server
  });
})();

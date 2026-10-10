import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import incidentRoutes from "./routes/incidents.js";
import simulateRoutes from "./routes/simulate.js";
import logRoutes from "./routes/logs.js";
import metricRoutes from "./routes/metrics.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Routes
app.use("/api/simulate", simulateRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/metrics", metricRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "memoryops" });
});

// Final error handler returning { error: message }
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  const status = err.status && typeof err.status === "number" ? err.status : 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;

if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
      console.log("MongoDB connected");
      app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch((err) => {
      console.error("MongoDB connection failed:", err.message);
      process.exit(1);
    });
} else {
  console.warn("MONGO_URI not set. Server listening without DB connection on port", PORT);
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

export default app;
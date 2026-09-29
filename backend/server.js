import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import incidentRoutes from "./routes/incidents.js";
import simulateRoutes from "./routes/simulate.js";

import { retainIncident, recallSimilar } from "./services/hindsight.js";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/simulate", simulateRoutes);
app.use("/api/incidents", incidentRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "memoryops" });
});
import Incident from "./models/Incident.js";

app.get("/api/incidents", async (req, res) => {
  res.json(await Incident.find().sort({ createdAt: -1 }));
});
const PORT = process.env.PORT || 5000;

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



app.post("/api/test/retain/:id", async (req, res) => {
  const incident = await Incident.findById(req.params.id);
  res.json(await retainIncident(incident));
});

app.get("/api/test/recall/:id", async (req, res) => {
  const incident = await Incident.findById(req.params.id);
  res.json(await recallSimilar(incident));
});
app.get("/api/test/groq-models", async (req, res) => {
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
  });
  const data = await r.json();
  res.json((data.data || []).map((m) => m.id));
});
import express from "express";
import mongoose from "mongoose";
import Incident from "../models/Incident.js";
import { recallSimilar, simplifyMemories, retainIncident } from "../services/hindsight.js";
import { diagnoseIncident } from "../services/diagnosis.js";
const router = express.Router();

// GET /api/incidents?status=open
router.get("/", async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const incidents = await Incident.find(filter).sort({ createdAt: -1 });
  res.json(incidents);
});

// GET /api/incidents/:id
router.get("/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid incident id" });
  }
  const incident = await Incident.findById(req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found" });
  res.json(incident);
});

// POST /api/incidents/:id/resolve
// body: { rootCause, fixApplied, outcome, resolvedBy }
router.post("/:id/resolve", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid incident id" });
  }
  const { rootCause, fixApplied, outcome, resolvedBy } = req.body;
  if (!rootCause || !fixApplied) {
    return res.status(400).json({ error: "rootCause and fixApplied are required" });
  }

  const incident = await Incident.findById(req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found" });

  incident.resolution = {
    rootCause,
    fixApplied,
    outcome: outcome || "worked", // worked | partially_worked | did_not_work
    resolvedBy: resolvedBy || "engineer",
    resolvedAt: new Date(),
    timeToResolveMins: Math.round((Date.now() - incident.createdAt) / 60000),
  };
  incident.status = "resolved";
  await incident.save();

  // Step 7: retain this resolution in Hindsight

  res.json(incident);
});

// POST /api/incidents/:id/diagnose
router.post("/:id/diagnose", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident id" });
    }
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const recall = await recallSimilar(incident);
    const memories = simplifyMemories(recall);

    const diagnosis = await diagnoseIncident(incident, memories);

    incident.recalledMemories = memories;
    incident.diagnosis = { ...diagnosis, diagnosedAt: new Date() };
    if (incident.status === "open") incident.status = "diagnosed";
    await incident.save();

    res.json(incident);
  } catch (err) {
    console.error("Diagnose failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/", async (req, res) => {
  await Incident.deleteMany({});
  res.json({ ok: true });
});
export default router;
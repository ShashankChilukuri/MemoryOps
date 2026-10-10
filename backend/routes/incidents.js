import express from "express";
import mongoose from "mongoose";
import Incident from "../models/Incident.js";
import { retainIncident, retainFeedback } from "../services/hindsight.js";
import { runDiagnosis } from "../services/pipeline.js";
import { notifyIncident } from "../services/notifier.js";

const router = express.Router();

// GET /api/incidents?status=open
router.get("/", async (req, res, next) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const incidents = await Incident.find(filter).sort({ createdAt: -1 });
    res.json(incidents);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/incidents (must be before /:id)
router.delete("/", async (req, res, next) => {
  try {
    await Incident.deleteMany({});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/incidents/:id
router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident id" });
    }
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });
    res.json(incident);
  } catch (err) {
    next(err);
  }
});

// POST /api/incidents/:id/resolve
// body: { rootCause, fixApplied, outcome, resolvedBy }
router.post("/:id/resolve", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident id" });
    }
    const { rootCause, fixApplied, outcome, resolvedBy } = req.body;
    if (!rootCause || !fixApplied) {
      return res.status(400).json({ error: "rootCause and fixApplied are required" });
    }

    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const diffMs = Math.max(0, Date.now() - new Date(incident.createdAt).getTime());
    incident.resolution = {
      rootCause,
      fixApplied,
      outcome: outcome || "worked", // worked | partially_worked | did_not_work
      resolvedBy: resolvedBy || "engineer",
      resolvedAt: new Date(),
      timeToResolveMins: Math.round(diffMs / 60000),
      timeToResolveSecs: Math.round(diffMs / 1000),
    };
    incident.status = "resolved";

    // Retain resolution in Hindsight
    try {
      await retainIncident(incident);
      incident.resolution.retained = true;
    } catch (err) {
      console.warn("Retain resolution in Hindsight failed:", err.message);
      incident.resolution.retained = false;
    }

    await incident.save();
    res.json(incident);
  } catch (err) {
    next(err);
  }
});

// POST /api/incidents/:id/diagnose
router.post("/:id/diagnose", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident id" });
    }

    const incident = await runDiagnosis(req.params.id);
    res.json(incident);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/incidents/:id/feedback
// body: { rating: "helpful" | "partly" | "not_helpful", note?: string }
router.post("/:id/feedback", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident id" });
    }

    const { rating, note } = req.body || {};
    const validRatings = ["helpful", "partly", "not_helpful"];
    if (!rating || !validRatings.includes(rating)) {
      return res.status(400).json({ error: "Invalid rating. Must be 'helpful', 'partly', or 'not_helpful'" });
    }

    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    if (!incident.diagnosis) {
      return res.status(400).json({ error: "Cannot submit feedback for an incident with no diagnosis" });
    }

    const ratingChanged = !incident.feedback || incident.feedback.rating !== rating;
    let retained = Boolean(incident.feedback?.retained);

    if (ratingChanged) {
      try {
        await retainFeedback(incident, rating, note);
        retained = true;
      } catch (err) {
        console.warn("Failed to retain feedback in Hindsight:", err.message);
        retained = false;
      }
    }

    incident.feedback = {
      rating,
      note: note || "",
      at: new Date(),
      retained,
    };
    incident.markModified("feedback");
    await incident.save();

    res.json(incident);
  } catch (err) {
    next(err);
  }
});

// POST /api/incidents/:id/notify
router.post("/:id/notify", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid incident id" });
    }

    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    if (!incident.diagnosis) {
      return res.status(400).json({ error: "Cannot send notification for an incident with no diagnosis" });
    }

    const updated = await notifyIncident(incident, { force: true });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
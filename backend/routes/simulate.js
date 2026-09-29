import express from "express";
import Incident from "../models/Incident.js";
import { scenarios } from "../simulator/scenarios.js";

const router = express.Router();

// list available scenarios
router.get("/", (req, res) => {
  res.json(Object.keys(scenarios));
});

// trigger a scenario
router.post("/:key", async (req, res) => {
  const build = scenarios[req.params.key];
  if (!build) return res.status(404).json({ error: "Unknown scenario" });

  const data = build();
  const incident = await Incident.create({ ...data, scenarioKey: req.params.key });
  res.status(201).json(incident);
});

export default router;
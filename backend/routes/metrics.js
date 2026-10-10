import express from "express";
import Incident from "../models/Incident.js";

const router = express.Router();

// GET /api/metrics
router.get("/", async (req, res, next) => {
  try {
    const totalIncidents = await Incident.countDocuments();

    // Only resolved incidents with a diagnosis
    const resolvedIncidents = await Incident.find({
      status: "resolved",
      diagnosis: { $exists: true, $ne: null },
    });

    const firstTimeSecs = [];
    const recurringSecs = [];

    for (const inc of resolvedIncidents) {
      if (!inc.diagnosis) continue;

      let secs = inc.resolution?.timeToResolveSecs;
      if (typeof secs !== "number" || isNaN(secs)) {
        const mins = Number(inc.resolution?.timeToResolveMins) || 0;
        secs = mins * 60;
      }

      if (inc.diagnosis.isRecurring) {
        recurringSecs.push(secs);
      } else {
        firstTimeSecs.push(secs);
      }
    }

    const firstTimeCount = firstTimeSecs.length;
    const firstTimeAvg = firstTimeCount > 0
      ? Math.round(firstTimeSecs.reduce((a, b) => a + b, 0) / firstTimeCount)
      : 0;

    const recurringCount = recurringSecs.length;
    const recurringAvg = recurringCount > 0
      ? Math.round(recurringSecs.reduce((a, b) => a + b, 0) / recurringCount)
      : 0;

    res.json({
      firstTime: { count: firstTimeCount, avgSecs: firstTimeAvg },
      recurring: { count: recurringCount, avgSecs: recurringAvg },
      totalIncidents,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

import express from "express";
import Incident from "../models/Incident.js";
import { normalizeSignature } from "../services/signature.js";
import { maybeAutoDiagnose } from "../services/pipeline.js";

const router = express.Router();

function cleanTitleMessage(msg) {
  if (!msg || typeof msg !== "string") return "";
  // Strip trailing "(...)"
  return msg.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function calculateSeverity(errorCount, eventCount) {
  if (errorCount >= 20) return "critical";
  if (errorCount >= 1) return "high";
  if (eventCount >= 3) return "medium";
  return "low";
}

// POST /api/logs
router.post("/", async (req, res, next) => {
  try {
    const rawEvents = req.body?.events;

    if (!Array.isArray(rawEvents)) {
      return res.status(400).json({ error: "'events' array is required in request body" });
    }

    if (rawEvents.length > 500) {
      return res.status(413).json({ error: "Batch too large: max 500 events allowed per request" });
    }

    let processed = 0;
    let ignoredInfo = 0;
    let stale = 0;
    let rejected = 0;

    const maxAgeMin = Number(process.env.INGEST_MAX_AGE_MIN) || 60;
    const maxAgeMs = maxAgeMin * 60 * 1000;
    const now = Date.now();

    const validEvents = [];

    for (const raw of rawEvents) {
      if (!raw || typeof raw !== "object") {
        rejected++;
        continue;
      }

      const { timestamp, level, service, message, context } = raw;

      if (
        !service ||
        typeof service !== "string" ||
        !message ||
        typeof message !== "string" ||
        !level ||
        typeof level !== "string" ||
        !timestamp
      ) {
        rejected++;
        continue;
      }

      const eventTime = new Date(timestamp).getTime();
      if (isNaN(eventTime)) {
        rejected++;
        continue;
      }

      const upperLevel = level.toUpperCase();
      if (!["INFO", "WARN", "ERROR"].includes(upperLevel)) {
        rejected++;
        continue;
      }

      // Check stale (> INGEST_MAX_AGE_MIN)
      if (eventTime < now - maxAgeMs) {
        stale++;
        continue;
      }

      // Check INFO
      if (upperLevel === "INFO") {
        ignoredInfo++;
        continue;
      }

      validEvents.push({
        timestamp: new Date(timestamp).toISOString(),
        timeMs: eventTime,
        level: upperLevel,
        service: service.trim(),
        message: message.trim(),
        context: context && typeof context === "object" ? context : {},
      });
    }

    // Sort valid WARN / ERROR events by timestamp ascending
    validEvents.sort((a, b) => a.timeMs - b.timeMs);

    const windowMin = Number(process.env.INCIDENT_WINDOW_MIN) || 10;
    const windowMs = windowMin * 60 * 1000;

    const touchedIncidentMap = new Map(); // id -> incident

    for (const ev of validEvents) {
      const isError = ev.level === "ERROR";
      const sig = normalizeSignature(ev.message);
      const cleanMsg = cleanTitleMessage(ev.message);
      const eventDate = new Date(ev.timestamp);

      // Find an open incident for this service within the incident window
      const cutoff = new Date(Math.min(now, ev.timeMs) - windowMs);

      let incident = await Incident.findOne({
        service: ev.service,
        status: { $ne: "resolved" },
        lastLogAt: { $gte: cutoff },
      }).sort({ lastLogAt: -1 });

      if (incident) {
        // Update existing incident
        incident.eventCount = (incident.eventCount || 0) + 1;
        if (isError) {
          // If first error, set title and signature
          if (!incident.errorCount || !incident.signature) {
            incident.title = `${ev.service}: ${cleanMsg}`;
            incident.signature = sig;
          }
          incident.errorCount = (incident.errorCount || 0) + 1;
        }

        if (!incident.lastLogAt || eventDate > incident.lastLogAt) {
          incident.lastLogAt = eventDate;
        }

        if (sig && !incident.signatures.includes(sig)) {
          incident.signatures.push(sig);
        }

        // Distinct logs (up to 20)
        const alreadyLogged = (incident.logs || []).some((l) => l.includes(ev.message));
        if (!alreadyLogged && incident.logs.length < 20) {
          incident.logs.push(`${ev.timestamp} ${ev.level} ${ev.message}`);
        }

        incident.context = { ...(incident.context || {}), ...(ev.context || {}) };
        incident.markModified("context");

        incident.severity = calculateSeverity(incident.errorCount, incident.eventCount);
        await incident.save();
        touchedIncidentMap.set(incident._id.toString(), incident);
      } else {
        // Create new incident
        const initialLogs = [`${ev.timestamp} ${ev.level} ${ev.message}`];
        const errorCount = isError ? 1 : 0;
        const eventCount = 1;

        incident = await Incident.create({
          title: `${ev.service}: ${cleanMsg}`,
          service: ev.service,
          severity: calculateSeverity(errorCount, eventCount),
          status: "open",
          source: "ingested",
          signature: isError ? sig : undefined,
          signatures: sig ? [sig] : [],
          eventCount,
          errorCount,
          lastLogAt: eventDate,
          logs: initialLogs,
          context: ev.context || {},
        });

        touchedIncidentMap.set(incident._id.toString(), incident);
      }

      processed++;
    }

    // Trigger auto-diagnosis in background if applicable
    for (const inc of touchedIncidentMap.values()) {
      maybeAutoDiagnose(inc);
    }

    res.json({
      incidentIds: Array.from(touchedIncidentMap.keys()),
      processed,
      ignoredInfo,
      stale,
      rejected,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

import Incident from "../models/Incident.js";
import { recallSimilar, simplifyMemories } from "./hindsight.js";
import { diagnoseIncident } from "./diagnosis.js";
import { notifyIncident } from "./notifier.js";

export const diagnosingIncidents = new Set();

export async function runDiagnosis(incidentId) {
  const idStr = incidentId.toString();
  if (diagnosingIncidents.has(idStr)) {
    const err = new Error("Incident diagnosis is currently in progress");
    err.status = 409;
    throw err;
  }

  diagnosingIncidents.add(idStr);
  try {
    const incident = await Incident.findById(incidentId);
    if (!incident) {
      const err = new Error("Incident not found");
      err.status = 404;
      throw err;
    }

    if (incident.status === "resolved") {
      const err = new Error("Incident is already resolved");
      err.status = 409;
      throw err;
    }

    let memories = [];
    let memoryUnavailable = false;

    try {
      const recall = await recallSimilar(incident);
      memories = simplifyMemories(recall);
    } catch (recallErr) {
      console.warn(`Hindsight recall failed for incident ${incidentId}:`, recallErr.message);
      memoryUnavailable = true;
      memories = [];
    }

    const diagnosis = await diagnoseIncident(incident, memories);

    incident.recalledMemories = memories;
    incident.diagnosis = {
      ...diagnosis,
      diagnosedAt: new Date(),
      ...(memoryUnavailable ? { memoryUnavailable: true } : {}),
    };

    if (incident.status === "open") {
      incident.status = "diagnosed";
    }

    await incident.save();

    // Call notifyIncident fire-and-forget
    notifyIncident(incident, { force: false }).catch((notifyErr) => {
      console.error(`Background notifyIncident error for ${incidentId}:`, notifyErr.message);
    });

    return incident;
  } finally {
    diagnosingIncidents.delete(idStr);
  }
}

export function maybeAutoDiagnose(incident) {
  const autoDiagnoseEnabled = process.env.AUTO_DIAGNOSE === "true";
  if (!autoDiagnoseEnabled) return;

  const minErrors = Number(process.env.AUTO_DIAGNOSE_MIN_ERRORS) || 3;
  if (
    incident.source === "ingested" &&
    !incident.diagnosis &&
    incident.status === "open" &&
    (incident.errorCount || 0) >= minErrors
  ) {
    const idStr = incident._id.toString();
    if (!diagnosingIncidents.has(idStr)) {
      console.log(`Starting background auto-diagnosis for incident ${idStr} (errors=${incident.errorCount})...`);
      runDiagnosis(incident._id).catch((err) => {
        console.error(`Auto-diagnosis background error for ${idStr}:`, err.message);
      });
    }
  }
}

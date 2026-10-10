import mongoose from "mongoose";

const incidentSchema = new mongoose.Schema(
  {
    title: String,
    service: String,
    severity: { type: String, enum: ["low", "medium", "high", "critical"] },
    scenarioKey: String,
    logs: [String],
    context: Object,
    status: { type: String, enum: ["open", "diagnosed", "resolved"], default: "open" },

    source: { type: String, enum: ["simulator", "ingested"], default: "simulator" },
    signature: String,
    signatures: { type: [String], default: [] },
    eventCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    lastLogAt: Date,
    feedback: Object,
    notification: Object,

    recalledMemories: [Object],
    diagnosis: Object,
    resolution: Object,
  },
  { timestamps: true }
);

incidentSchema.index({ service: 1, status: 1, lastLogAt: -1 });

const Incident = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);

export default Incident;
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

    recalledMemories: [Object],
    diagnosis: Object,
    resolution: Object,
  },
  { timestamps: true }
);

const Incident = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);

export default Incident;
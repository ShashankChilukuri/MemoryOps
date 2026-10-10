import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import Incident from "../models/Incident.js";

const SEVERITY_LEVELS = { low: 1, medium: 2, high: 3, critical: 4 };
const serviceCooldownMap = new Map();

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getRecipientsForService(service) {
  // Check backend/config/owners.json
  const configCandidates = [
    path.resolve(process.cwd(), "config", "owners.json"),
    path.resolve(process.cwd(), "backend", "config", "owners.json"),
  ];

  for (const cfgPath of configCandidates) {
    if (fs.existsSync(cfgPath)) {
      try {
        const raw = fs.readFileSync(cfgPath, "utf-8");
        const owners = JSON.parse(raw);
        if (owners && owners[service]) {
          const list = Array.isArray(owners[service]) ? owners[service] : [owners[service]];
          return list;
        }
      } catch (err) {
        console.warn("Failed reading owners.json:", err.message);
      }
    }
  }

  // Fallback to ALERT_EMAILS env variable
  const envEmails = process.env.ALERT_EMAILS || "";
  return envEmails
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export async function notifyIncident(incidentInput, { force = false } = {}) {
  // Re-fetch incident to avoid stale model references
  const incident = incidentInput._id
    ? await Incident.findById(incidentInput._id) || incidentInput
    : incidentInput;

  if (!incident.diagnosis) {
    return incident;
  }

  const minSev = (process.env.NOTIFY_MIN_SEVERITY || "high").toLowerCase();
  const currentSev = (incident.severity || "low").toLowerCase();
  const minRank = SEVERITY_LEVELS[minSev] || 3;
  const currentRank = SEVERITY_LEVELS[currentSev] || 1;

  // 1. Severity check
  if (!force && currentRank < minRank) {
    incident.notification = {
      status: "suppressed",
      to: [],
      error: `Severity '${incident.severity}' is below notification threshold '${minSev}'`,
    };
    incident.markModified("notification");
    await incident.save();
    return incident;
  }

  // 2. Send at most once per incident unless force
  if (!force && incident.notification?.status === "sent") {
    return incident;
  }

  // 3. Cooldown per service
  const cooldownMin = Number(process.env.NOTIFY_COOLDOWN_MIN) || 15;
  const cooldownMs = cooldownMin * 60 * 1000;
  const lastSentTime = serviceCooldownMap.get(incident.service);
  if (!force && lastSentTime && Date.now() - lastSentTime < cooldownMs) {
    incident.notification = {
      status: "suppressed",
      to: [],
      error: `Service '${incident.service}' is within cooldown window (${cooldownMin}m)`,
    };
    incident.markModified("notification");
    await incident.save();
    return incident;
  }

  // 4. Determine recipients
  const rawRecipients = getRecipientsForService(incident.service);
  const validRecipients = rawRecipients.filter(isValidEmail);

  if (validRecipients.length === 0) {
    incident.notification = {
      status: "no_recipients",
      to: [],
      error: "No valid recipient email addresses found",
    };
    incident.markModified("notification");
    await incident.save();
    return incident;
  }

  // 5. Build email content
  const sevUpper = (incident.severity || "UNKNOWN").toUpperCase();
  const recurringPrefix = incident.diagnosis.isRecurring ? "[RECURRING] " : "";
  const subject = `${recurringPrefix}[${sevUpper}] ${incident.title}`;

  const dashboardBase = (process.env.DASHBOARD_URL || "http://localhost:5173").replace(/\/$/, "");
  const dashboardLink = `${dashboardBase}/?incident=${incident._id}`;
  const startedAt = incident.createdAt ? new Date(incident.createdAt).toISOString() : new Date().toISOString();
  const eventCount = incident.eventCount || incident.logs?.length || 0;
  const cause = incident.diagnosis.probableCause || "Under investigation";
  const confidence = incident.diagnosis.confidence ?? 0;
  const fixSteps = Array.isArray(incident.diagnosis.suggestedFix) ? incident.diagnosis.suggestedFix : [];
  const avoidedFixes = Array.isArray(incident.diagnosis.avoidedFixes) ? incident.diagnosis.avoidedFixes : [];

  // Used memories for "Worked last time"
  const usedIds = new Set((incident.diagnosis.usedMemoryIds || []).map(String));
  const usedMemories = (incident.recalledMemories || []).filter((m) => usedIds.has(String(m.id)));

  const logLines = (incident.logs || []).slice(0, 5);

  // Plain text body
  let text = `MEMORYOPS INCIDENT ALERT\n`;
  text += `========================\n\n`;
  text += `Severity: ${incident.severity}\n`;
  text += `Service: ${incident.service}\n`;
  text += `Started: ${startedAt}\n`;
  text += `Events: ${eventCount}\n\n`;
  text += `PROBABLE CAUSE (Confidence: ${confidence}%):\n${cause}\n\n`;
  text += `SUGGESTED FIX:\n`;
  fixSteps.forEach((step, idx) => {
    text += `${idx + 1}. ${step}\n`;
  });
  text += `\n`;

  if (usedMemories.length > 0) {
    text += `WORKED LAST TIME (Past Memories):\n`;
    usedMemories.forEach((m) => {
      text += `- ${m.text}\n`;
    });
    text += `\n`;
  }

  if (avoidedFixes.length > 0) {
    text += `DO NOT TRY (Avoided Fixes):\n`;
    avoidedFixes.forEach((af) => {
      text += `- ${af}\n`;
    });
    text += `\n`;
  }

  text += `RECENT LOGS (up to 5 lines):\n`;
  logLines.forEach((l) => {
    text += `  ${l}\n`;
  });
  text += `\n`;
  text += `View Incident in Dashboard: ${dashboardLink}\n`;

  // HTML body
  let html = `<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #24292f; max-width: 650px; margin: 0 auto; padding: 20px;">`;
  html += `<h2 style="color: #cf222e; margin-bottom: 8px;">${escapeHtml(subject)}</h2>`;
  html += `<div style="background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">`;
  html += `<div><strong>Service:</strong> ${escapeHtml(incident.service)}</div>`;
  html += `<div><strong>Severity:</strong> <span style="text-transform: uppercase; font-weight: bold;">${escapeHtml(incident.severity)}</span></div>`;
  html += `<div><strong>Started:</strong> ${escapeHtml(startedAt)}</div>`;
  html += `<div><strong>Events Received:</strong> ${eventCount}</div>`;
  html += `</div>`;

  html += `<h3 style="margin-bottom: 4px;">Probable Cause <span style="font-size: 13px; font-weight: normal; color: #57609a;">(Model-reported confidence: ${confidence}%)</span></h3>`;
  html += `<p style="font-size: 15px; margin-top: 0;">${escapeHtml(cause)}</p>`;

  html += `<h3 style="margin-bottom: 6px;">Suggested Fix Steps</h3>`;
  html += `<ol style="padding-left: 20px; margin-top: 4px;">`;
  fixSteps.forEach((step) => {
    html += `<li>${escapeHtml(step)}</li>`;
  });
  html += `</ol>`;

  if (usedMemories.length > 0) {
    html += `<h3 style="color: #1a7f37; margin-bottom: 6px;">Worked Last Time</h3>`;
    html += `<ul style="padding-left: 20px; margin-top: 4px;">`;
    usedMemories.forEach((m) => {
      html += `<li>${escapeHtml(m.text)}</li>`;
    });
    html += `</ul>`;
  }

  if (avoidedFixes.length > 0) {
    html += `<h3 style="color: #9a6700; margin-bottom: 6px;">Do Not Try</h3>`;
    html += `<ul style="padding-left: 20px; margin-top: 4px;">`;
    avoidedFixes.forEach((af) => {
      html += `<li>${escapeHtml(af)}</li>`;
    });
    html += `</ul>`;
  }

  html += `<h3 style="margin-bottom: 6px;">Sample Logs</h3>`;
  html += `<pre style="background: #0d1117; color: #c9d1d9; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto;">`;
  logLines.forEach((l) => {
    html += `${escapeHtml(l)}\n`;
  });
  html += `</pre>`;

  html += `<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #d0d7de;">`;
  html += `<a href="${escapeHtml(dashboardLink)}" style="display: inline-block; background: #0969da; color: #ffffff; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-weight: 600;">Open in MemoryOps Dashboard</a>`;
  html += `</div>`;
  html += `</body></html>`;

  const mailOptions = {
    from: process.env.MAIL_FROM || "alerts@memoryops.local",
    to: validRecipients,
    subject,
    text,
    html,
  };

  // 6. SMTP or jsonTransport
  if (!process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const info = await transporter.sendMail(mailOptions);
    console.log("=== SIMULATED EMAIL ALERT (SMTP_HOST not set) ===");
    console.log(`To: ${validRecipients.join(", ")}`);
    console.log(`Subject: ${subject}`);
    console.log(`\n${text}`);
    console.log("================================================");

    incident.notification = {
      status: "not_configured",
      to: validRecipients,
      sentAt: new Date(),
      messageId: info.messageId,
      error: "SMTP_HOST not configured",
    };
    incident.markModified("notification");
    await incident.save();
    return incident;
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = port === 465;
  const transportConfig = {
    host: process.env.SMTP_HOST,
    port,
    secure,
  };
  if (process.env.SMTP_USER || process.env.SMTP_PASS) {
    transportConfig.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }

  const transporter = nodemailer.createTransport(transportConfig);

  let sendErr = null;
  let info = null;
  try {
    info = await transporter.sendMail(mailOptions);
  } catch (err1) {
    console.warn("First email attempt failed, retrying in 2 seconds:", err1.message);
    await new Promise((r) => setTimeout(r, 2000));
    try {
      info = await transporter.sendMail(mailOptions);
    } catch (err2) {
      sendErr = err2;
    }
  }

  if (sendErr) {
    console.error("Failed to send email after retry:", sendErr.message);
    incident.notification = {
      status: "failed",
      to: validRecipients,
      error: sendErr.message,
    };
  } else {
    serviceCooldownMap.set(incident.service, Date.now());
    incident.notification = {
      status: "sent",
      to: validRecipients,
      sentAt: new Date(),
      messageId: info?.messageId,
    };
  }

  incident.markModified("notification");
  await incident.save();
  return incident;
}

export default notifyIncident;

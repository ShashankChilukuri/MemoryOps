import { useEffect, useState, useMemo } from "react";
import * as api from "./api";
import "./index.css";

const SCENARIOS = {
  payment_timeout: { icon: "💳", label: "Payment timeout" },
  payment_gateway_502: { icon: "🌐", label: "Gateway 502" },
  db_pool_exhausted: { icon: "🗄️", label: "DB pool exhausted" },
  cart_null_reference: { icon: "🛒", label: "Cart null reference" },
  slow_menu_query: { icon: "🐢", label: "Slow menu query" },
  jwt_auth_loop: { icon: "🔑", label: "JWT login loop" },
};

const timeAgo = (d) => {
  if (!d) return "just now";
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};

const confColor = (c) => (c >= 80 ? "green" : c >= 60 ? "amber" : "red");

function formatSecs(s) {
  if (!s || s === 0) return "0s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatNotificationStatus(notif) {
  if (!notif) return null;
  if (notif.status === "sent") {
    const time = notif.sentAt
      ? new Date(notif.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
    const count = notif.to?.length || 1;
    return `Emailed ${count} developer${count > 1 ? "s" : ""} at ${time}`;
  }
  if (notif.status === "not_configured") {
    return "Email not configured (printed to console)";
  }
  if (notif.status === "no_recipients") {
    return "No email recipients configured";
  }
  if (notif.status === "suppressed") {
    return `Email suppressed (${notif.error || "cooldown or severity"})`;
  }
  if (notif.status === "failed") {
    return `Email failed: ${notif.error || "error"}`;
  }
  return notif.status;
}

function Stepper({ incident }) {
  const d = incident.diagnosis;
  const steps = [
    { label: "Detected", done: true },
    { label: "Recalled", done: !!d },
    { label: "Diagnosed", done: !!d },
    { label: "Resolved", done: incident.status === "resolved" },
    { label: "Retained", done: !!incident.resolution?.retained },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={s.label} className={`step ${s.done ? "done" : ""} ${i === current ? "current" : ""}`}>
          <div className="dot">{s.done ? "✓" : i + 1}</div>
          <span className="step-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function FormattedLogLine({ line }) {
  const match = line.match(/^(\S+)\s+(ERROR|WARN|INFO)\s+(.*)$/);
  if (!match) {
    return <div className="log-row"><span className="log-raw">{line}</span></div>;
  }
  const [, ts, level, msg] = match;
  return (
    <div className={`log-row level-${level.toLowerCase()}`}>
      <span className="log-ts">{ts}</span>
      <span className={`log-badge ${level.toLowerCase()}`}>{level}</span>
      <span className="log-msg">{msg}</span>
    </div>
  );
}

export default function App() {
  const [incidents, setIncidents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ rootCause: "", fixApplied: "", outcome: "worked" });

  // Filter states
  const [filterTab, setFilterTab] = useState("all"); // "all" | "open" | "diagnosed" | "resolved" | "ingested"
  const [onlySameService, setOnlySameService] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyRelatedMemories, setOnlyRelatedMemories] = useState(true);

  const selected = incidents.find((i) => i._id === selectedId);
  const d = selected?.diagnosis;

  // Read ?incident=<id> deep link on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incId = params.get("incident");
    if (incId) {
      setSelectedId(incId);
    }
  }, []);

  const refresh = async () => {
    try {
      const [list, m] = await Promise.all([api.getIncidents(), api.getMetrics()]);
      setIncidents(list);
      setMetrics(m);
      // Auto select first incident if none selected
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0]._id);
      }
    } catch (err) {
      console.warn("Refresh error:", err.message);
    }
  };

  // Refresh every 3 seconds, skipping while tab is hidden
  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      if (document.visibilityState !== "hidden") {
        refresh();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const run = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
    setBusy("");
  };

  const handleSelectIncident = (id) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("incident", id);
    window.history.replaceState(null, "", url.toString());
  };

  const onSimulate = (key) =>
    run("simulate", async () => {
      const inc = await api.simulate(key);
      handleSelectIncident(inc._id);
    });

  const onResolve = () =>
    run("resolve", async () => {
      await api.resolve(selected._id, form);
      setForm({ rootCause: "", fixApplied: "", outcome: "worked" });
    });

  const onReset = () => {
    if (!confirm("Delete all incidents from the dashboard? (Hindsight memory is kept)")) return;
    run("reset", async () => {
      await api.clearIncidents();
      setSelectedId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("incident");
      window.history.replaceState(null, "", url.toString());
    });
  };

  const onFeedback = (rating) => {
    if (!selected) return;
    run("feedback", async () => {
      await api.sendFeedback(selected._id, { rating });
    });
  };

  const onNotify = () => {
    if (!selected) return;
    run("notify", async () => {
      await api.notifyIncident(selected._id);
    });
  };

  // Filtered incidents for the sidebar list
  const filteredIncidents = useMemo(() => {
    return incidents.filter((i) => {
      // 1. Status / Source tab filter
      if (filterTab === "open" && i.status !== "open") return false;
      if (filterTab === "diagnosed" && i.status !== "diagnosed") return false;
      if (filterTab === "resolved" && i.status !== "resolved") return false;
      if (filterTab === "ingested" && i.source !== "ingested") return false;

      // 2. Only same service filter
      if (onlySameService && selected && i.service !== selected.service) {
        return false;
      }

      // 3. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = i.title?.toLowerCase().includes(q);
        const matchService = i.service?.toLowerCase().includes(q);
        if (!matchTitle && !matchService) return false;
      }

      return true;
    });
  }, [incidents, filterTab, onlySameService, selected, searchQuery]);

  // Related past incidents for the currently selected incident
  const relatedPastIncidents = useMemo(() => {
    if (!selected) return [];
    return incidents.filter((i) => i._id !== selected._id && i.service === selected.service);
  }, [incidents, selected]);

  // Filtered recalled memories (Related vs All)
  const displayedMemories = useMemo(() => {
    if (!selected?.recalledMemories) return [];
    if (!onlyRelatedMemories) return selected.recalledMemories;

    const usedIds = new Set((d?.usedMemoryIds || []).map(String));
    const serviceName = (selected.service || "").toLowerCase();

    return selected.recalledMemories.filter((m) => {
      // 1. If used by diagnosis -> always related
      if (usedIds.has(String(m.id))) return true;
      // 2. If entity or text matches the service -> related
      const textMatch = (m.text || "").toLowerCase().includes(serviceName);
      const entityMatch = (m.entities || []).some((e) =>
        String(e).toLowerCase().includes(serviceName)
      );
      if (textMatch || entityMatch) return true;
      // 3. Or high relevance score (>= 0.6)
      return (m.relevance || 0) >= 0.6;
    });
  }, [selected, d, onlyRelatedMemories]);

  const copyLogs = () => {
    if (!selected?.logs) return;
    navigator.clipboard.writeText(selected.logs.join("\n"));
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo-badge">🧠</div>
          <div className="brand-text">
            <span className="brand-name">MemoryOps</span>
            <span className="brand-tag">Incident Response Agent</span>
          </div>
          <div className="system-pill">
            <span className="pulse-dot"></span>
            <span>Hindsight Active</span>
          </div>
        </div>
        <button className="ghost danger-ghost" onClick={onReset}>
          Reset demo
        </button>
      </header>

      <div className="layout">
        <aside>
          <div className="aside-section">
            <div className="section-head">
              <h3>Simulate Outage</h3>
            </div>
            <div className="scenarios">
              {Object.entries(SCENARIOS).map(([key, s]) => (
                <button
                  key={key}
                  className="scenario-btn"
                  disabled={!!busy}
                  onClick={() => onSimulate(key)}
                >
                  <span className="sc-icon">{s.icon}</span>
                  <span className="sc-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {metrics && (
            <div className="metrics-card">
              <div className="metrics-head">
                <h4>⚡ Time To Resolve</h4>
                <span className="metrics-total">{metrics.totalIncidents || 0} incidents</span>
              </div>
              <div className="metrics-grid">
                <div className="metric-box">
                  <div className="metric-val">{formatSecs(metrics.firstTime?.avgSecs)}</div>
                  <div className="metric-sub">First-time ({metrics.firstTime?.count || 0})</div>
                </div>
                <div className="metric-box recurring-box">
                  <div className="metric-val accent">{formatSecs(metrics.recurring?.avgSecs)}</div>
                  <div className="metric-sub">Recurring ({metrics.recurring?.count || 0})</div>
                </div>
              </div>
            </div>
          )}

          <div className="incidents-panel-head">
            <div className="incidents-title-row">
              <h3>Incidents</h3>
              <span className="count-badge">{filteredIncidents.length}</span>
            </div>

            {/* Quick search */}
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Filter by service or title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="clear-search" onClick={() => setSearchQuery("")}>×</button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="filter-tabs">
              <button
                className={`tab-btn ${filterTab === "all" ? "active" : ""}`}
                onClick={() => setFilterTab("all")}
              >
                All
              </button>
              <button
                className={`tab-btn ${filterTab === "open" ? "active" : ""}`}
                onClick={() => setFilterTab("open")}
              >
                Open
              </button>
              <button
                className={`tab-btn ${filterTab === "diagnosed" ? "active" : ""}`}
                onClick={() => setFilterTab("diagnosed")}
              >
                Diagnosed
              </button>
              <button
                className={`tab-btn ${filterTab === "resolved" ? "active" : ""}`}
                onClick={() => setFilterTab("resolved")}
              >
                Resolved
              </button>
              <button
                className={`tab-btn ${filterTab === "ingested" ? "active" : ""}`}
                onClick={() => setFilterTab("ingested")}
              >
                Live
              </button>
            </div>

            {/* Service filter toggle */}
            {selected && (
              <div className="service-filter-row">
                <button
                  className={`service-toggle-btn ${onlySameService ? "active" : ""}`}
                  onClick={() => setOnlySameService(!onlySameService)}
                >
                  <span>{onlySameService ? "✓ Showing only" : "Filter to"}</span>
                  <strong>{selected.service}</strong>
                </button>
              </div>
            )}
          </div>

          <div className="list">
            {filteredIncidents.map((i) => {
              const eventCnt = i.eventCount || i.logs?.length || 0;
              const isSelected = i._id === selectedId;
              return (
                <div
                  key={i._id}
                  onClick={() => handleSelectIncident(i._id)}
                  className={`item sev-${i.severity} ${isSelected ? "active" : ""}`}
                >
                  <div className="item-title">{i.title}</div>
                  <div className="item-meta">
                    {i.source === "ingested" && <span className="pill pill-live">LIVE</span>}
                    <span className={`pill ${i.status}`}>{i.status}</span>
                    <span className="svc-tag">{i.service}</span>
                    <span className="meta-cnt">{eventCnt} events</span>
                    <span className="meta-time">{timeAgo(i.createdAt)}</span>
                  </div>
                </div>
              );
            })}
            {!filteredIncidents.length && (
              <div className="empty-list">
                <p>No matching incidents found.</p>
                {(onlySameService || searchQuery || filterTab !== "all") && (
                  <button
                    className="ghost sm"
                    onClick={() => {
                      setOnlySameService(false);
                      setSearchQuery("");
                      setFilterTab("all");
                    }}
                  >
                    Reset filters
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        <main>
          {!selected ? (
            <div className="empty">
              <div className="empty-icon">🧠</div>
              <h2>Select or trigger an incident</h2>
              <p className="muted">MemoryOps will recall similar past incidents and diagnose the new one.</p>
            </div>
          ) : (
            <>
              {/* Incident Header Card */}
              <div className="incident-hero-card">
                <div className="hero-top">
                  <div className="hero-title-group">
                    <div className="badge-row">
                      <span className={`badge sev-${selected.severity}`}>{selected.severity}</span>
                      {selected.source === "ingested" && (
                        <span className="badge badge-live">⚡ LIVE INGESTION</span>
                      )}
                      <span className="chip service-chip">📦 {selected.service}</span>
                      {Object.entries(selected.context || {}).map(([k, v]) => (
                        <span key={k} className="chip">{k}: {String(v)}</span>
                      ))}
                    </div>
                    <h2>{selected.title}</h2>
                  </div>
                  {selected.status === "open" && (
                    <button
                      className="primary diagnose-btn"
                      disabled={!!busy}
                      onClick={() => run("diagnose", () => api.diagnose(selected._id))}
                    >
                      {busy === "diagnose" ? (
                        <>
                          <span className="spinner"></span>
                          <span>Analyzing with memory…</span>
                        </>
                      ) : (
                        <>
                          <span>🧠 Diagnose with memory</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <Stepper incident={selected} />

                {/* Email Alert Status Bar */}
                <div className="notification-bar">
                  <div className="notification-status">
                    <span className="notif-icon">✉️</span>
                    <span>{formatNotificationStatus(selected.notification) || "Email notification not sent"}</span>
                  </div>
                  <button
                    className="ghost sm notify-btn"
                    disabled={!!busy || !selected.diagnosis}
                    onClick={onNotify}
                  >
                    {busy === "notify" ? "Sending…" : "Email developers"}
                  </button>
                </div>
              </div>

              {/* Terminal Logs Card */}
              <section className="card terminal-card">
                <div className="card-head">
                  <div className="terminal-header-title">
                    <span className="term-dot red"></span>
                    <span className="term-dot amber"></span>
                    <span className="term-dot green"></span>
                    <h4>Runtime Logs</h4>
                    <span className="pill logs-count-pill">
                      {selected.eventCount || selected.logs?.length || 0} events · {selected.logs?.length || 0} distinct lines
                    </span>
                  </div>
                  <button className="copy-btn" onClick={copyLogs} title="Copy logs to clipboard">
                    📋 Copy
                  </button>
                </div>
                <div className="terminal-body">
                  {(selected.logs || []).map((line, idx) => (
                    <FormattedLogLine key={idx} line={line} />
                  ))}
                </div>
              </section>

              {/* Diagnosis & Memory Grid */}
              {d && (
                <div className="grid">
                  {/* AI Diagnosis Card */}
                  <section className="card ai-card">
                    <div className="card-head">
                      <div className="head-title-wrap">
                        <span className="card-icon">⚡</span>
                        <h4>AI Diagnosis</h4>
                      </div>
                      {d.isRecurring && <span className="badge recurring">↻ Recurring issue</span>}
                    </div>

                    {d.memoryUnavailable && (
                      <div className="warn-banner">
                        ⚠️ Hindsight memory unavailable. Diagnosed from logs alone.
                      </div>
                    )}

                    <div className="conf-widget">
                      <div className="conf-label">
                        <span>Model-reported confidence</span>
                        <b className="conf-value">{d.confidence}%</b>
                      </div>
                      <div className="bar">
                        <div
                          className={`fill ${confColor(d.confidence)}`}
                          style={{ width: `${d.confidence}%` }}
                        />
                      </div>
                    </div>

                    <div className="cause-box">
                      <div className="box-tag">Probable Cause</div>
                      <p className="cause-text">{d.probableCause}</p>
                    </div>

                    <div className="fix-section">
                      <h5>Recommended Fix</h5>
                      <div className="fix-steps">
                        {(d.suggestedFix || []).map((step, i) => (
                          <div key={i} className="fix-step-item">
                            <span className="step-num">{i + 1}</span>
                            <span className="step-text">{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {d.avoidedFixes && d.avoidedFixes.length > 0 && (
                      <div className="avoided-section">
                        <h5>🛡️ Not Recommended</h5>
                        <ul className="avoided-list">
                          {d.avoidedFixes.map((af, i) => (
                            <li key={i}>{af}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="reasoning-box">
                      <h5>Reasoning</h5>
                      <p className="reasoning-text">{d.reasoning}</p>
                    </div>

                    {/* Interactive Feedback Section */}
                    <div className="feedback-section">
                      <div className="feedback-header">
                        <span>Rate this recommendation</span>
                        {selected.feedback?.retained && (
                          <span className="feedback-saved">✓ Saved to memory</span>
                        )}
                        {selected.feedback && selected.feedback.retained === false && (
                          <span className="feedback-unsaved">Saved locally (memory offline)</span>
                        )}
                      </div>
                      <div className="feedback-buttons">
                        <button
                          className={`feedback-btn ${selected.feedback?.rating === "helpful" ? "active" : ""}`}
                          disabled={!!busy}
                          onClick={() => onFeedback("helpful")}
                        >
                          👍 Helpful
                        </button>
                        <button
                          className={`feedback-btn ${selected.feedback?.rating === "partly" ? "active" : ""}`}
                          disabled={!!busy}
                          onClick={() => onFeedback("partly")}
                        >
                          👌 Partly
                        </button>
                        <button
                          className={`feedback-btn ${selected.feedback?.rating === "not_helpful" ? "active" : ""}`}
                          disabled={!!busy}
                          onClick={() => onFeedback("not_helpful")}
                        >
                          👎 Not helpful
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Memory Recall Card */}
                  <section className="card memory-card">
                    <div className="card-head">
                      <div className="head-title-wrap">
                        <span className="card-icon">🧠</span>
                        <h4>Memory Recall</h4>
                      </div>
                      <div className="memory-filter-pills">
                        <button
                          className={`mem-tab-btn ${onlyRelatedMemories ? "active" : ""}`}
                          onClick={() => setOnlyRelatedMemories(true)}
                        >
                          Related ({displayedMemories.length})
                        </button>
                        <button
                          className={`mem-tab-btn ${!onlyRelatedMemories ? "active" : ""}`}
                          onClick={() => setOnlyRelatedMemories(false)}
                        >
                          All ({(selected.recalledMemories || []).length})
                        </button>
                      </div>
                    </div>

                    <div className="assessment-box">
                      <div className="assessment-label">LLM Context Assessment</div>
                      <p className="assessment-text">{d.memoryAssessment}</p>
                    </div>

                    <div className="memories-scroll-container">
                      {displayedMemories.map((m) => {
                        const used = d.usedMemoryIds?.includes(m.id);
                        return (
                          <div key={m.id} className={`mem-card ${used ? "used" : "contextual"}`}>
                            <div className="mem-top">
                              <div className="mem-tags">
                                <span className={`mem-status-pill ${used ? "applied" : "candidate"}`}>
                                  {used ? "✓ Applied to Fix" : "Candidate Memory"}
                                </span>
                                {(m.entities || []).slice(0, 3).map((ent, i) => (
                                  <span key={i} className="mem-entity-pill">{ent}</span>
                                ))}
                              </div>
                              <span className="match-score">
                                {Math.round((m.relevance || 0) * 100)}% match
                              </span>
                            </div>
                            <div className="mem-body">
                              <p className="mem-text">{m.text}</p>
                            </div>
                          </div>
                        );
                      })}
                      {!displayedMemories.length && (
                        <div className="empty-memories">
                          <p className="muted">No relevant memories found for this symptom.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              )}

              {/* Related Service Incidents Card */}
              {relatedPastIncidents.length > 0 && (
                <section className="card related-incidents-card">
                  <div className="card-head">
                    <div className="head-title-wrap">
                      <span className="card-icon">🔗</span>
                      <h4>Related Past Incidents ({selected.service})</h4>
                    </div>
                    <span className="muted">{relatedPastIncidents.length} other occurrences</span>
                  </div>
                  <div className="related-incidents-grid">
                    {relatedPastIncidents.map((ri) => (
                      <div
                        key={ri._id}
                        className={`related-inc-item ${ri.status}`}
                        onClick={() => handleSelectIncident(ri._id)}
                      >
                        <div className="ri-top">
                          <span className={`pill ${ri.status}`}>{ri.status}</span>
                          <span className={`badge sev-${ri.severity}`}>{ri.severity}</span>
                          <span className="ri-time">{timeAgo(ri.createdAt)}</span>
                        </div>
                        <div className="ri-title">{ri.title}</div>
                        {ri.resolution && (
                          <div className="ri-resolution">
                            <span className="ri-res-label">Fix:</span> {ri.resolution.fixApplied}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Resolve Form Card */}
              {d && selected.status !== "resolved" && (
                <section className="card resolve-card">
                  <div className="card-head">
                    <div className="head-title-wrap">
                      <span className="card-icon">✅</span>
                      <h4>Resolve & Train MemoryOps</h4>
                    </div>
                  </div>
                  <p className="muted resolve-hint">
                    Confirmed resolutions are permanently retained into Hindsight to automate future fixes.
                  </p>
                  <div className="resolve-form-grid">
                    <input
                      className="form-input"
                      placeholder="Actual root cause (e.g. Missing STRIPE_API_URL in production)"
                      value={form.rootCause}
                      onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
                    />
                    <input
                      className="form-input"
                      placeholder="Fix that was applied (e.g. Exported env variable and restarted pod)"
                      value={form.fixApplied}
                      onChange={(e) => setForm({ ...form, fixApplied: e.target.value })}
                    />
                  </div>
                  <div className="resolve-action-row">
                    <select
                      className="form-select"
                      value={form.outcome}
                      onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                    >
                      <option value="worked">Fix worked completely</option>
                      <option value="partially_worked">Fix partially worked</option>
                      <option value="did_not_work">Fix did not work</option>
                    </select>
                    <button
                      className="primary resolve-btn"
                      disabled={!!busy || !form.rootCause || !form.fixApplied}
                      onClick={onResolve}
                    >
                      {busy === "resolve" ? "Saving to memory…" : "Mark Resolved & Retain Fix"}
                    </button>
                  </div>
                </section>
              )}

              {/* Resolved Card */}
              {selected.resolution && (
                <section className="card resolved-card">
                  <div className="card-head">
                    <div className="head-title-wrap">
                      <span className="card-icon">🎉</span>
                      <h4>✓ Resolved {selected.resolution.retained ? "· Retained in Hindsight Memory" : ""}</h4>
                    </div>
                  </div>
                  <div className="resolved-summary-grid">
                    <div>
                      <span className="res-tag">Root Cause</span>
                      <p className="res-text">{selected.resolution.rootCause}</p>
                    </div>
                    <div>
                      <span className="res-tag">Fix Applied</span>
                      <p className="res-text">{selected.resolution.fixApplied}</p>
                    </div>
                  </div>
                  <div className="resolved-footer">
                    <span className="chip outcome-chip">{selected.resolution.outcome}</span>
                    {selected.resolution.timeToResolveSecs !== undefined && (
                      <span className="chip time-chip">
                        ⏱️ Solved in {formatSecs(selected.resolution.timeToResolveSecs)}
                      </span>
                    )}
                  </div>
                  {selected.resolution.retained === false && (
                    <p className="warn">Note: Could not save to Hindsight. Check backend logs.</p>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
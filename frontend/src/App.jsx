import { useEffect, useState } from "react";
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
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};

const confColor = (c) => (c >= 80 ? "green" : c >= 60 ? "amber" : "red");

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
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [incidents, setIncidents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ rootCause: "", fixApplied: "", outcome: "worked" });

  const selected = incidents.find((i) => i._id === selectedId);
  const d = selected?.diagnosis;

  const refresh = async () => setIncidents(await api.getIncidents());
  useEffect(() => { refresh(); }, []);

  const run = async (label, fn) => {
    setBusy(label);
    try { await fn(); await refresh(); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    setBusy("");
  };

  const onSimulate = (key) =>
    run("simulate", async () => setSelectedId((await api.simulate(key))._id));

  const onResolve = () =>
    run("resolve", async () => {
      await api.resolve(selected._id, form);
      setForm({ rootCause: "", fixApplied: "", outcome: "worked" });
    });

  const onReset = () => {
    if (!confirm("Delete all incidents from the dashboard? (Hindsight memory is kept)")) return;
    run("reset", async () => { await api.clearIncidents(); setSelectedId(null); });
  };

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="logo">🧠</span> MemoryOps
          <small>Incident response that learns</small></div>
        <button className="ghost" onClick={onReset}>Reset demo</button>
      </header>

      <div className="layout">
        <aside>
          <h3>Trigger an incident</h3>
          <div className="scenarios">
            {Object.entries(SCENARIOS).map(([key, s]) => (
              <button key={key} className="scenario" disabled={!!busy} onClick={() => onSimulate(key)}>
                <span>{s.icon}</span>{s.label}
              </button>
            ))}
          </div>

          <h3>Incidents <span className="count">{incidents.length}</span></h3>
          <div className="list">
            {incidents.map((i) => (
              <div key={i._id} onClick={() => setSelectedId(i._id)}
                   className={`item sev-${i.severity} ${i._id === selectedId ? "active" : ""}`}>
                <div className="item-title">{i.title}</div>
                <div className="item-meta">
                  <span className={`pill ${i.status}`}>{i.status}</span>
                  <span>{i.service}</span>
                  <span>{timeAgo(i.createdAt)}</span>
                </div>
              </div>
            ))}
            {!incidents.length && <p className="muted">No incidents yet. Trigger one above.</p>}
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
              <div className="title-row">
                <div>
                  <h2>{selected.title}</h2>
                  <div className="meta">
                    <span className={`badge sev-${selected.severity}`}>{selected.severity}</span>
                    <span>{selected.service}</span>
                    {Object.entries(selected.context || {}).map(([k, v]) => (
                      <span key={k} className="chip">{k}: {String(v)}</span>
                    ))}
                  </div>
                </div>
                {selected.status === "open" && (
                  <button className="primary" disabled={!!busy}
                          onClick={() => run("diagnose", () => api.diagnose(selected._id))}>
                    {busy === "diagnose" ? "Analyzing…" : "Diagnose with memory"}
                  </button>
                )}
              </div>

              <Stepper incident={selected} />

              <section className="card">
                <h4>Logs</h4>
                <pre>{selected.logs.join("\n")}</pre>
              </section>

              {d && (
                <div className="grid">
                  <section className="card">
                    <div className="card-head">
                      <h4>AI diagnosis</h4>
                      {d.isRecurring && <span className="badge recurring">↻ Recurring issue</span>}
                    </div>
                    <div className="conf">
                      <div className="conf-label"><span>Confidence</span><b>{d.confidence}%</b></div>
                      <div className="bar"><div className={`fill ${confColor(d.confidence)}`} style={{ width: `${d.confidence}%` }} /></div>
                    </div>
                    <p className="cause">{d.probableCause}</p>
                    <h5>Recommended fix</h5>
                    <ol>{d.suggestedFix.map((s, i) => <li key={i}>{s}</li>)}</ol>
                    <h5>Reasoning</h5>
                    <p className="muted">{d.reasoning}</p>
                  </section>

                  <section className="card">
                    <div className="card-head">
                      <h4>Memory recall</h4>
                      <span className="muted">{d.usedMemoryIds?.length || 0} of {selected.recalledMemories.length} used</span>
                    </div>
                    <p className="assessment">{d.memoryAssessment}</p>
                    {selected.recalledMemories.map((m) => {
                      const used = d.usedMemoryIds?.includes(m.id);
                      return (
                        <div key={m.id} className={`mem ${used ? "used" : "ignored"}`}>
                          <div className="mem-head">
                            <span>{m.type}</span>
                            <span>{used ? "✓ used" : "not used"} · {Math.round(m.relevance * 100)}% match</span>
                          </div>
                          {m.text}
                        </div>
                      );
                    })}
                    {!selected.recalledMemories.length && (
                      <p className="muted">No relevant memories. This looks like a first-time incident.</p>
                    )}
                  </section>
                </div>
              )}

              {d && selected.status !== "resolved" && (
                <section className="card">
                  <h4>Resolve and teach MemoryOps</h4>
                  <p className="muted">What actually fixed it? This gets stored in Hindsight for future incidents.</p>
                  <input placeholder="Actual root cause" value={form.rootCause}
                         onChange={(e) => setForm({ ...form, rootCause: e.target.value })} />
                  <input placeholder="Fix that was applied" value={form.fixApplied}
                         onChange={(e) => setForm({ ...form, fixApplied: e.target.value })} />
                  <div className="row">
                    <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                      <option value="worked">Fix worked</option>
                      <option value="partially_worked">Partially worked</option>
                      <option value="did_not_work">Did not work</option>
                    </select>
                    <button className="primary" disabled={!!busy || !form.rootCause || !form.fixApplied} onClick={onResolve}>
                      {busy === "resolve" ? "Saving to memory…" : "Mark resolved"}
                    </button>
                  </div>
                </section>
              )}

              {selected.resolution && (
                <section className="card resolved-card">
                  <h4>✓ Resolved{selected.resolution.retained ? " and saved to memory" : ""}</h4>
                  <p><b>Root cause:</b> {selected.resolution.rootCause}</p>
                  <p><b>Fix:</b> {selected.resolution.fixApplied} <span className="chip">{selected.resolution.outcome}</span></p>
                  {selected.resolution.retained === false && (
                    <p className="warn">Could not save to Hindsight. Check the backend logs.</p>
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
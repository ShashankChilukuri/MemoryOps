import { useState } from "react";

export default function ResponseLog({ logs = [] }) {
  const [cleared, setCleared] = useState(false);

  const visibleLogs = cleared ? [] : logs;

  const getStatusLabel = (status) => {
    const code = Number(status);

    if (!Number.isFinite(code) || code === 0) return "NO RESPONSE";
    if (code >= 200 && code < 300) return "SUCCESS";
    if (code >= 400) return "FAILED";
    if (code >= 300 && code < 400) return "REDIRECT";

    return "INFO";
  };

  const getStatusClass = (status) => {
    const code = Number(status);

    if (!Number.isFinite(code) || code === 0) return "log-status-neutral";
    if (code >= 200 && code < 300) return "log-status-success";
    if (code >= 400) return "log-status-error";
    if (code >= 300 && code < 400) return "log-status-warning";

    return "log-status-neutral";
  };

  const formatDuration = (duration) => {
    const value = Number(duration);
    return Number.isFinite(value) && value >= 0
      ? `${value.toLocaleString()} ms`
      : "—";
  };

  return (
    <section className="card response-log">
      <div className="response-log-heading">
        <div>
          <h2>Response Log</h2>
          <p className="muted">
            Recent API requests and response performance.
          </p>
        </div>

        <div className="response-log-actions">
          <span className="request-count">
            {visibleLogs.length} {visibleLogs.length === 1 ? "request" : "requests"}
          </span>

          <button
            type="button"
            className="clear-logs-button"
            onClick={() => setCleared(true)}
            disabled={visibleLogs.length === 0}
          >
            Clear Logs
          </button>
        </div>
      </div>

      {visibleLogs.length === 0 ? (
        <div className="log-empty-state">
          <span className="log-empty-icon" aria-hidden="true">
            ↗
          </span>
          <strong>No requests to display</strong>
          <p className="muted">
            API requests will appear here when you use the dashboard.
          </p>
        </div>
      ) : (
        <div className="log-table-wrapper">
          <div className="log-table-header">
            <span>METHOD</span>
            <span>ENDPOINT</span>
            <span>STATUS</span>
            <span>LATENCY</span>
          </div>

          <div className="log-entries" aria-live="polite">
            {visibleLogs.map((log, index) => (
              <div
                className="log-entry"
                key={`${log.method}-${log.path}-${index}`}
              >
                <span className="log-method">
                  {log.method || "—"}
                </span>

                <code className="log-endpoint" title={log.path || ""}>
                  {log.path || "Unknown endpoint"}
                </code>

                <span
                  className={`log-status ${getStatusClass(log.status)}`}
                  title={`HTTP status: ${log.status ?? "unknown"}`}
                >
                  {getStatusLabel(log.status)}
                  {log.status != null && log.status !== "" && log.status !== "—"
                    ? ` ${log.status}`
                    : ""}
                </span>

                <span className="log-duration">
                  {formatDuration(log.duration)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const faults = [
  {
    id: "payment_timeout",
    name: "Payment Timeout",
    description: "Payment provider fails to respond in time.",
    symptom: "Checkout requests time out.",
  },
  {
    id: "gateway_502",
    name: "Gateway 502",
    description: "Payment gateway returns HTTP 502.",
    symptom: "Bad Gateway errors.",
  },
  {
    id: "db_pool_exhausted",
    name: "DB Pool Exhausted",
    description: "Database connections become unavailable.",
    symptom: "Checkout fails due to connection exhaustion.",
  },
  {
    id: "slow_query",
    name: "Slow Query",
    description: "Restaurant queries perform collection scans.",
    symptom: "Restaurant requests experience high latency.",
  },
];

export default function FaultControls({
  active,
  onSelect,
  busy = false,
}) {
  // Supports either a single active fault name or a list of active faults.
  const isActive = (id) => {
    if (Array.isArray(active)) {
      return active.some((item) =>
        typeof item === "string"
          ? item === id
          : (item.id || item.scenario || item.name) === id &&
            item.enabled !== false
      );
    }

    if (active && typeof active === "object") {
      const value = active[id];
      return typeof value === "object"
        ? Boolean(value.enabled ?? value.active)
        : Boolean(value);
    }

    return active === id;
  };

  const getActivationTime = (id) => {
    if (!Array.isArray(active)) return null;

    const item = active.find(
      (value) =>
        typeof value === "object" &&
        (value.id || value.scenario || value.name) === id
    );

    return item?.activatedAt || item?.startedAt || null;
  };

  return (
    <section className="card fault-section">
      <div className="fault-heading">
        <div>
          <h2>Fault Controls</h2>
          <p className="muted">
            Faults are injected on purpose for the demo.
          </p>
        </div>

        <button
          className="reset-button"
          onClick={() => onSelect("reset")}
          disabled={busy}
        >
          Turn All Faults Off
        </button>
      </div>

      <div className="fault-grid">
        {faults.map((fault) => {
          const enabled = isActive(fault.id);
          const activatedAt = getActivationTime(fault.id);

          return (
            <article
              className={`fault-card ${enabled ? "fault-active" : ""}`}
              key={fault.id}
            >
              <div className="fault-top">
                <span
                  className={`fault-status ${
                    enabled ? "status-on" : "status-off"
                  }`}
                >
                  {enabled ? "FAULT ACTIVE" : "NORMAL"}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${fault.name}`}
                  className={`fault-switch ${
                    enabled ? "switch-on" : ""
                  }`}
                  disabled={busy}
                  onClick={() => onSelect(fault.id, !enabled)}
                >
                  <span />
                </button>
              </div>

              <h3>{fault.name}</h3>
              <p>{fault.description}</p>

              <div className="fault-symptom">
                <strong>Expected symptom</strong>
                <span>{fault.symptom}</span>
              </div>

              <p className="activation-time">
                {enabled
                  ? activatedAt
                    ? `Active since ${new Date(
                        activatedAt
                      ).toLocaleTimeString()}`
                    : "Active · time not provided by service"
                  : "Fault is disabled"}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

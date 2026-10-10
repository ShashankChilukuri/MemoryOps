import { useEffect, useState } from "react";
import {
  checkout,
  getFaults,
  getHealth,
  getRecentLogs,
  resetFaults,
  searchRestaurants,
  setFault,
} from "./api";

import RestaurantList from "./components/RestaurantList";
import CheckoutPanel from "./components/CheckoutPanel";
import FaultControls from "./components/FaultControls";
import ResponseLog from "./components/ResponseLog";

export default function App() {
  const [active, setActive] = useState(null);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  const record = (result) => {
    setLogs((previous) =>
      [
        {
          method: result.method || "GET",
          path: result.path || "Unknown",
          status: result.status ?? "—",
          duration: result.duration ?? 0,
        },
        ...previous,
      ].slice(0, 20)
    );
  };

  const refreshDashboard = async () => {
    const results = await Promise.all([getHealth(), getFaults()]);

    const healthResult = results[0];
    const faultResult = results[1];

    setHealth(healthResult);

    if (!healthResult.ok && !faultResult.ok) {
      setError(
        healthResult.error ||
          faultResult.error ||
          "Could not connect to the service."
      );
    } else {
      setError("");
    }

    if (faultResult.ok) {
      setActive(
        faultResult.active ??
          faultResult.activeFaults ??
          healthResult.activeFaults ??
          null
      );
    } else if (healthResult.ok) {
      setActive(healthResult.activeFaults ?? null);
    }

    record(healthResult);
    record(faultResult);
  };

  useEffect(() => {
    refreshDashboard();
  }, []);

  const fault = async (name, enabled) => {
    setBusy(true);
    setError("");

    try {
      let result;

      if (name === "reset") {
        result = await resetFaults();
      } else {
        result = await setFault(name, enabled);
      }

      record(result);

      if (!result.ok) {
        setError(
          result.error ||
            `Could not update ${name}. Check the service connection.`
        );
        return;
      }

      await refreshDashboard();
    } finally {
      setBusy(false);
    }
  };

  const search = async (city, cuisine) => {
    const result = await searchRestaurants(city, cuisine);
    record(result);
    return result;
  };

  const order = async () => {
    const result = await checkout();
    record(result);
    return result;
  };

  return (
    <main>
      <header>
        <p className="eyebrow">MemoryOps observability demo</p>
        <h1>Restaurant Checkout Lab</h1>
        <p>Trigger predictable faults and watch API behavior.</p>

        <div className="card">
          <h2>Service Status</h2>
          <p>
            Status:{" "}
            <strong>
              {health?.ok
                ? "Connected"
                : health?.status === 0
                  ? "Unreachable"
                  : "Checking"}
            </strong>
          </p>

          {error && <p className="error">{error}</p>}

          <button onClick={refreshDashboard} disabled={busy}>
            Refresh Status
          </button>
        </div>
      </header>

      <FaultControls
        active={active}
        onSelect={fault}
        busy={busy}
      />

      <section className="grid">
        <RestaurantList onSearch={search} />
        <CheckoutPanel onCheckout={order} />
      </section>

      <ResponseLog logs={logs} />
    </main>
  );
}
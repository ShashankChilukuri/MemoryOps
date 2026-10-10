
async function request(path, options = {}) {
  const started = performance.now();

  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });

    const body = await response.json().catch(() => ({}));

    return {
      ...body,
      ok: response.ok,
      status: response.status,
      duration: Math.round(performance.now() - started),
      method: options.method || "GET",
      path,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      duration: Math.round(performance.now() - started),
      method: options.method || "GET",
      path,
      error: error.message || "Service unreachable",
    };
  }
}

// Existing features
export const getFaults = () => request("/admin/faults");

export const setFault = (fault, enabled) =>
  request(`/admin/faults/${encodeURIComponent(fault)}`, {
    method: "POST",
    ...(typeof enabled === "boolean"
      ? { body: JSON.stringify({ enabled }) }
      : {}),
  });

export const searchRestaurants = (city, cuisine) =>
  request(
    `/restaurants?city=${encodeURIComponent(city)}&cuisine=${encodeURIComponent(cuisine)}`
  );

export const checkout = () =>
  request("/checkout", {
    method: "POST",
    body: "{}",
  });

// New control-panel features
export const getHealth = () => request("/health");

export const getRecentLogs = () =>
  request("/logs/recent?limit=50");

export const setTraffic = (enabled, rps) =>
  request("/traffic", {
    method: "POST",
    body: JSON.stringify({ enabled, rps }),
  });

export const resetFaults = () =>
  request("/chaos/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  
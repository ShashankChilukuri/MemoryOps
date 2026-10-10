import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "https://memoryops-f8ru.onrender.com/api";

const api = axios.create({ baseURL: API_BASE });

export const getScenarios = () => api.get("/simulate").then((r) => r.data);
export const simulate = (key) => api.post(`/simulate/${key}`).then((r) => r.data);
export const getIncidents = () => api.get("/incidents").then((r) => r.data);
export const diagnose = (id) => api.post(`/incidents/${id}/diagnose`).then((r) => r.data);
export const resolve = (id, body) => api.post(`/incidents/${id}/resolve`, body).then((r) => r.data);
export const clearIncidents = () => api.delete("/incidents").then((r) => r.data);
export const sendFeedback = (id, body) => api.post(`/incidents/${id}/feedback`, body).then((r) => r.data);
export const getMetrics = () => api.get("/metrics").then((r) => r.data);
export const notifyIncident = (id) => api.post(`/incidents/${id}/notify`).then((r) => r.data);
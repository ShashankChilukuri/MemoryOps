import axios from "axios";

const api = axios.create({ baseURL: "http://localhost:5000/api" });

export const getScenarios = () => api.get("/simulate").then((r) => r.data);
export const simulate = (key) => api.post(`/simulate/${key}`).then((r) => r.data);
export const getIncidents = () => api.get("/incidents").then((r) => r.data);
export const diagnose = (id) => api.post(`/incidents/${id}/diagnose`).then((r) => r.data);
export const resolve = (id, body) => api.post(`/incidents/${id}/resolve`, body).then((r) => r.data);
export const clearIncidents = () => api.delete("/incidents").then((r) => r.data);
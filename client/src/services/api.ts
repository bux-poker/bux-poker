import axios from "axios";

// Use relative URL for local dev (goes through Vite proxy)
// Or use env var for production
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

export function getApiBaseUrl() {
  return API_BASE_URL;
}

// Default export for convenience
export default api;

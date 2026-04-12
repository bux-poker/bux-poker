import axios from "axios";
import { getClientApiBaseUrl } from "@shared/utils/clientApiBaseUrl";

const API_BASE_URL = getClientApiBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 45000,
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config as any;
    const status = error?.response?.status;
    const code = error?.code;
    const method = String(config?.method || "").toLowerCase();
    const isGet = method === "get";
    const retryable =
      code === "ECONNABORTED" ||
      code === "ERR_NETWORK" ||
      status === 502 ||
      status === 503 ||
      status === 504;

    if (config && isGet && retryable && !config.__retryOnce) {
      config.__retryOnce = true;
      return api.request(config);
    }
    return Promise.reject(error);
  }
);

export function getApiBaseUrl() {
  return API_BASE_URL;
}

// Default export for convenience
export default api;

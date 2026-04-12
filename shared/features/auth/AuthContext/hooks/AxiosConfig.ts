import axios from 'axios';
import {
  enforceBuxPokerSameOriginApiBase,
  getClientApiBaseUrl,
} from '@shared/utils/clientApiBaseUrl';

const apiBaseUrl = getClientApiBaseUrl();
axios.defaults.baseURL = apiBaseUrl;
enforceBuxPokerSameOriginApiBase(axios);
axios.defaults.withCredentials = true;

const isDev = import.meta.env.DEV;

/** Firefox reports aborted fetches as NS_ERROR_ABORT; Socket.IO can abort polling during upgrade. */
export function isBenignClientAbort(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  const code = e.code;
  const name = e.name;
  const msg = String(e.message ?? '');
  if (code === 'ERR_CANCELED' || code === 'ECONNABORTED' || name === 'CanceledError' || name === 'AbortError')
    return true;
  if (/abort|cancel(?:l)?ed/i.test(msg)) return true;
  if (msg.includes('NS_ERROR_ABORT')) return true;
  return false;
}

// Request/response interceptors (verbose logs only in dev; skip noise from aborted requests)
axios.interceptors.request.use(
  (config) => {
    if (isDev) {
      console.log('Making request:', {
        url: config.url,
        method: config.method,
        headers: config.headers,
        data: config.data,
      });
    }
    return config;
  },
  (error) => {
    if (!isBenignClientAbort(error)) {
      console.error('Request error:', error);
    }
    return Promise.reject(error);
  }
);

axios.interceptors.response.use(
  (response) => {
    if (isDev) {
      console.log('Received response:', {
        status: response.status,
        data: response.data,
        headers: response.headers,
      });
    }
    return response;
  },
  (error) => {
    if (!isBenignClientAbort(error)) {
      console.error('Response error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
    }
    return Promise.reject(error);
  }
);

export default axios;

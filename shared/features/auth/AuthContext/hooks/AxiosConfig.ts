import axios from 'axios';

// Configure axios defaults
// Use VITE_API_BASE_URL or fallback to Render backend URL
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://bux-poker-server.onrender.com';
axios.defaults.baseURL = apiBaseUrl;
axios.defaults.withCredentials = true;

// Add request/response interceptors for debugging
axios.interceptors.request.use(
  (config) => {
    console.log('Making request:', {
      url: config.url,
      method: config.method,
      headers: config.headers,
      data: config.data
    });
    return config;
  },
  (error) => {
    console.error('Request error:', error);
    return Promise.reject(error);
  }
);

axios.interceptors.response.use(
  (response) => {
    console.log('Received response:', {
      status: response.status,
      data: response.data,
      headers: response.headers
    });
    return response;
  },
  (error) => {
    console.error('Response error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    return Promise.reject(error);
  }
);

export default axios;

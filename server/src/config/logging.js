// EMERGENCY: Disable all logging in production for maximum performance
const isDev = process.env.NODE_ENV === 'development';

console.log('[LOGGING] NODE_ENV:', process.env.NODE_ENV);
console.log('[LOGGING] isDev:', isDev);

// TEMPORARY: Always enable logging for debugging
console.log('[LOGGING] TEMPORARILY ENABLING ALL LOGS FOR DEBUGGING');

// if (!isDev) {
//   // Disable all console logging in production
//   const noop = () => {};
//   console.log = noop;
//   console.error = noop;
//   console.warn = noop;
//   console.info = noop;
//   console.debug = noop;
// }

export { isDev };

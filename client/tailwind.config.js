/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      screens: {
        'game-351': '351px',
        'game-401': '401px',
        'game-451': '451px',
        'game-501': '501px',
        'game-551': '551px',
        'game-601': '601px',
        'game-651': '651px',
        'game-701': '701px',
        'game-751': '751px',
        'game-801': '801px',
        'game-851': '851px',
      },
      colors: {
        bux: {
          ink: '#0b0f14',
          panel: '#1a2332',
          felt: '#0a3d2e',
          rail: '#5c3d2e',
          brass: '#c4a574',
          accent: '#10b981',
          danger: '#dc2626',
          warn: '#d97706',
        },
        primary: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22"
        }
      }
    }
  },
  plugins: []
};


/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
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
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49"
        }
      }
    }
  },
  plugins: []
};


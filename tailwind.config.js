/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#082124',
          hover: '#0e3135',
          active: '#fae2aa',
          activeText: '#082124',
          text: '#8ba2a4',
          textMuted: '#5d7577',
        },
        page: {
          DEFAULT: '#f4f7f6',
          dark: '#0d161a',
          card: '#ffffff',
          cardDark: '#142026',
          border: '#dbe5e0',
          borderDark: '#22353f',
          hover: '#eef4f1',
          hoverDark: '#1a2b34',
        },
        brand: {
          DEFAULT: '#0f4a3c',
          hover: '#135e4d',
          light: '#e6f3ee',
          dark: '#1b6352',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Bengali', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}


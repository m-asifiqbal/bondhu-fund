/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // corner radii are 5px (0.3125rem) smaller than Tailwind's defaults for lg and up
      borderRadius: { lg: '0.25rem', xl: '0.4375rem', '2xl': '0.6875rem', '3xl': '1.1875rem' },
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


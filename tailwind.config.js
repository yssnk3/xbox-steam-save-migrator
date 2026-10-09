/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      colors: {
        notion: {
          bg: '#FFFFFF',
          text: '#37352F',
          muted: '#787774',
          border: '#E8E7E4',
          hover: '#F1F1EF',
          active: '#E8E7E4',
          accent: '#2F80ED',
          success: '#0F7B6C',
          warning: '#D9730D',
          danger: '#E03E3E',
          tag: '#F1F1EF',
          card: '#FFFFFF',
          sidebar: '#FBFAF9',
        },
      },
      borderRadius: {
        notion: '4px',
      },
      boxShadow: {
        notion: '0 1px 2px rgba(0, 0, 0, 0.04)',
        'notion-hover': '0 2px 8px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
};

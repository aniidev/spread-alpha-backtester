/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        q: {
          bg: '#060d1a',
          surface: '#0c1629',
          elevated: '#0f1e38',
          border: '#1a2f50',
          'border-bright': '#2a4a75',
          accent: '#38bdf8',
          'accent-dim': '#0ea5e9',
          green: '#10b981',
          'green-dim': '#059669',
          red: '#ef4444',
          'red-dim': '#dc2626',
          amber: '#f59e0b',
          violet: '#a78bfa',
          text: '#e2e8f0',
          muted: '#94a3b8',
          faint: '#475569',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
}

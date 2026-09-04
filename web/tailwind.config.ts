import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#0B0F14', soft: '#161C24', line: '#232B36' },
        paper: { DEFAULT: '#FAFAF8', card: '#FFFFFF' },
        accent: { DEFAULT: '#0052FF', soft: '#E8EFFF' },
        gain: '#0E9F6E',
        loss: '#E02424',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
} satisfies Config

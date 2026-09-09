import type { Config } from 'tailwindcss'

/**
 * Brutalist editorial, monochromatic, one accent.
 * Structure is carried by hairlines and hard rules, never by fills or shadows.
 * Radius is 0 everywhere — that is a design rule, not a default.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#111111',
          void: '#080808',
        },
        ground: {
          DEFAULT: '#fcfcfc',
          inset: '#f3efef',
        },
        accent: {
          DEFAULT: '#1a2fd6',
          // The accent is only legible on light grounds. Anything sitting on
          // #111111 or #080808 must use this instead.
          dark: '#8f9dff',
        },
        body: {
          DEFAULT: '#333333',
          soft: '#5a5858',
          mute: '#8a8a8a',
          dark: '#d4d2d2',
        },
        rule: {
          hair: '#d8d8d8',
          mid: '#b5b2b2',
          dark: '#2a2929',
        },
        track: '#e4e0e0',
        ghost: '#171617',
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-instrument)', 'Georgia', 'serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        none: '0',
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '0',
      },
      boxShadow: {
        none: 'none',
        DEFAULT: 'none',
        sm: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
      },
      letterSpacing: {
        display: '-0.04em',
        screen: '-0.035em',
        figure: '-0.03em',
        kicker: '0.18em',
        label: '0.16em',
        monolabel: '0.14em',
        button: '0.13em',
        title: '0.06em',
      },
      animation: {
        rise: 'folio-rise 330ms cubic-bezier(0.2,0.8,0.2,1) both',
        sheet: 'folio-sheet 280ms cubic-bezier(0.2,0.8,0.2,1) both',
        spin: 'folio-spin 900ms linear infinite',
      },
      keyframes: {
        'folio-rise': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'folio-sheet': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'none' },
        },
        'folio-spin': {
          to: { transform: 'rotate(360deg)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config

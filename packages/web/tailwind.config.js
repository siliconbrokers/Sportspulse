/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Habilita el cambio de modo manual/clase
  theme: {
    extend: {
      colors: {
        brand: {
          // MODO OSCURO (Noche)
          dark: "#0B0E14",
          surface: "#1A1D24",
          primary: "#00E0FF", // Cyber Neon
          "text-primary": "#FFFFFF",
          "text-secondary": "#8A94A8",
          // MODO CLARO (Día)
          light: "#F8FAFC",
          "light-surface": "#FFFFFF",
          // ESTADOS
          success: "#4ADE80",
          alert: "#F97316",
        },
        status: {
          success: 'var(--sp-status-success)',
          error:   'var(--sp-status-error)',
          warning: 'var(--sp-status-warning)',
          live:    'var(--sp-status-live)',
          zombie:  'var(--sp-status-zombie)',
          neutral: 'var(--sp-status-neutral)',
          info:    'var(--sp-status-info)',
        },
        zone: {
          champions:    'var(--sp-zone-champions)',
          europa:       'var(--sp-zone-europa)',
          conference:   'var(--sp-zone-conference)',
          playoff:      'var(--sp-zone-playoff)',
          'playoff-alt':'var(--sp-zone-playoff-alt)',
          liguilla:     'var(--sp-zone-liguilla)',
          relegation:   'var(--sp-zone-relegation)',
          sudamericana: 'var(--sp-zone-sudamericana)',
        },
        form: {
          win:  'var(--sp-form-win)',
          draw: 'var(--sp-form-draw)',
          loss: 'var(--sp-form-loss)',
        },
      },
      borderRadius: {
        'bento': '1.5rem',       // 24px para las cajas grandes
        'bento-inner': '0.75rem' // 12px para botones/mini-tarjetas
      },
      boxShadow: {
        'neon': '0 0 15px rgba(0, 224, 255, 0.4)',
      },
      animation: {
        'pulse-live': 'pulse-live 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'pulse-live': {
          '0%, 100%': { opacity: 1, transform: 'scale(1)' },
          '50%': { opacity: .5, transform: 'scale(1.05)' },
        }
      }
    },
  },
  plugins: [],
}

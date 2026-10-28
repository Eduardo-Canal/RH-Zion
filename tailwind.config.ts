/* Tailwind config for the frontend react app. This is where the app theme should be defined: https://v2.tailwindcss.com/docs/configuration. */
import type { Config } from 'tailwindcss'
import animatePlugin from 'tailwindcss-animate'
import typographyPlugin from '@tailwindcss/typography'
import aspectRatioPlugin from '@tailwindcss/aspect-ratio'

export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        display: ['SF Pro Display', 'Inter var', 'system-ui', 'sans-serif'],
        serif: ['EB Garamond', 'serif'],
        mono: ['VT323', 'monospace'],
        // New Fonts for Adapta Landing
        instrument: ['Instrument Serif', 'serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
        vintage: {
          paper: 'hsl(var(--vintage-paper))',
          text: 'hsl(var(--vintage-text))',
        },
        chassis: {
          base: 'hsl(var(--chassis-base))',
          border: 'hsl(var(--chassis-border))',
          shadow: 'hsl(var(--chassis-shadow))',
        },
        rainbow: {
          red: 'hsl(var(--rainbow-red))',
          orange: 'hsl(var(--rainbow-orange))',
          yellow: 'hsl(var(--rainbow-yellow))',
          green: 'hsl(var(--rainbow-green))',
          blue: 'hsl(var(--rainbow-blue))',
          purple: 'hsl(var(--rainbow-purple))',
        },
        // Adapta Landing Palette
        salmon: '#FF9678',
        periwinkle: '#CCD7E4',
        sage: '#C8DFA8',
        cream: '#F5F2EA',
        ink: '#1A1A18',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      transitionProperty: {
        width: 'width',
        height: 'height',
      },
      boxShadow: {
        subtle:
          '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        elevation: '0 4px 20px rgba(0, 0, 0, 0.05)',
        'chassis-sm': '2px 2px 0px 0px hsl(var(--chassis-shadow))',
        'chassis-md': '4px 4px 0px 0px hsl(var(--chassis-shadow))',
        'chassis-lg': '6px 6px 0px 0px hsl(var(--chassis-shadow))',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.42, 0, 0.58, 1)',
      },
      animation: {
        'spin-slow': 'spin 12s linear infinite',
        drift: 'drift 30s linear infinite',
      },
    },
  },
  plugins: [animatePlugin, typographyPlugin, aspectRatioPlugin],
} satisfies Config

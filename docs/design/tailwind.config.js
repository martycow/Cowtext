// tailwind.config.js — theme extension generated from tokens.css
// Every colour resolves through a CSS variable so the warmth variants and a
// future light theme are a single [data-warmth] / :root override, not a rebuild.
//
// This file does not exist in the repo yet — creating it (plus tailwind + postcss,
// and importing tokens.css from src/main.tsx) is backlog item 9.1, phase 0.
// Content globs match the current Vite layout: index.html at the root, all
// frontend source under src/. src-tauri/ is deliberately excluded.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: 'var(--surface-canvas)',
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          inset: 'var(--surface-inset)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        content: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
          inverse: 'var(--text-inverse)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          text: 'var(--accent-text)',
          surface: 'var(--accent-surface)',
          border: 'var(--accent-border)',
        },
        amber: {
          DEFAULT: 'var(--amber)',
          text: 'var(--amber-text)',
          surface: 'var(--amber-surface)',
          border: 'var(--amber-border)',
        },
        success: { DEFAULT: 'var(--success)', text: 'var(--success-text)', surface: 'var(--success-surface)' },
        warning: { DEFAULT: 'var(--warning)', text: 'var(--warning-text)', surface: 'var(--warning-surface)' },
        danger:  { DEFAULT: 'var(--danger)',  text: 'var(--danger-text)',  surface: 'var(--danger-surface)' },
        info:    { DEFAULT: 'var(--info)',    text: 'var(--info-text)',    surface: 'var(--info-surface)' },
        role: {
          persona:      'var(--role-persona)',
          rules:        'var(--role-rules)',
          architecture: 'var(--role-architecture)',
          workflow:     'var(--role-workflow)',
          task:         'var(--role-task)',
          reference:    'var(--role-reference)',
          glossary:     'var(--role-glossary)',
        },
        edge: {
          imports:     'var(--edge-imports)',
          references:  'var(--edge-references)',
          conditional: 'var(--edge-conditional)',
          sequence:    'var(--edge-sequence)',
          selected:    'var(--edge-selected)',
        },
      },
      fontFamily: {
        sans:  ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
        pixel: ['Silkscreen', 'monospace'],
      },
      fontSize: {
        micro: ['9.5px', { lineHeight: '1' }],
        '2xs': ['10.5px', { lineHeight: '1.3' }],
        xs:    ['11px',   { lineHeight: '1.4' }],
        sm:    ['12px',   { lineHeight: '1.45' }],
        base:  ['13px',   { lineHeight: '1.45' }],
        md:    ['14px',   { lineHeight: '1.5' }],
        lg:    ['16px',   { lineHeight: '1.4' }],
        xl:    ['20px',   { lineHeight: '1.3' }],
        '2xl': ['24px',   { lineHeight: '1.25' }],
      },
      spacing: {
        0.5: '2px', 1: '4px', 1.5: '6px', 2: '8px', 3: '12px',
        4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px',
        topbar: '44px', row: '28px', 'row-comfy': '34px',
        control: '28px', 'control-sm': '24px', 'control-lg': '32px',
        inspector: '392px', node: '244px',
      },
      borderRadius: {
        xs: '2px', sm: '3px', DEFAULT: '4px', md: '4px',
        lg: '6px', xl: '8px', pill: '999px',
      },
      boxShadow: {
        card:    '0 1px 2px rgba(0,0,0,.35)',
        popover: '0 4px 14px rgba(0,0,0,.45)',
        dropdown:'0 12px 36px rgba(0,0,0,.60)',
        modal:   '0 24px 64px rgba(0,0,0,.60)',
        live:    '0 0 18px rgba(232,163,61,.16)',
        focus:   '0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent)',
      },
      transitionDuration: {
        instant: '80ms', fast: '140ms', base: '180ms', slow: '220ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.2,0,0,1)',
        in:  'cubic-bezier(.4,0,1,1)',
        inout: 'cubic-bezier(.4,0,.2,1)',
      },
      zIndex: {
        canvas: '0', 'canvas-ui': '10', panel: '20', sticky: '30',
        dropdown: '100', modal: '200', toast: '300', palette: '400', tooltip: '500',
      },
      keyframes: {
        'ct-pulse': { '0%': { transform: 'scale(1)', opacity: '.6' }, '70%,100%': { transform: 'scale(1.06)', opacity: '0' } },
        'ct-blink': { '0%,100%': { opacity: '1' }, '50%': { opacity: '.3' } },
      },
      animation: {
        'live-ring': 'ct-pulse 1600ms cubic-bezier(.2,0,0,1) infinite',
        blink: 'ct-blink 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

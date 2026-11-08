/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        // 全部走 CSS 变量：明暗主题与强调色由 index.css 的 :root / [data-theme] / [data-accent] 决定。
        // 组件里的 bg-ink-* / text-ink-* / border-ink-* 无需改动即可跟随主题。
        ink: {
          base: 'var(--ink-base)',
          surface: 'var(--ink-surface)',
          elevated: 'var(--ink-elevated)',
          raised: 'var(--ink-raised)',
          text: 'var(--ink-text)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
          border: 'var(--ink-border)',
          borderSoft: 'var(--ink-border-soft)',
          solid: 'var(--ink-solid)',
          'solid-hover': 'var(--ink-solid-hover)',
          accent: 'var(--ink-accent)',
          'accent-soft': 'var(--ink-accent-soft)',
          success: 'var(--ink-success)',
          warning: 'var(--ink-warning)',
          danger: 'var(--ink-danger)',
          'xbox-to-steam': 'var(--ink-x2s)',
          'steam-to-xbox': 'var(--ink-s2x)',
        },
      },
      borderRadius: {
        // 新拟态规范：容器 12px、控件 8px
        card: '12px',
        btn: '8px',
      },
      boxShadow: {
        // 由 CSS 变量驱动，随主题切换明暗
        raise: 'var(--shadow-raise)',
        inset: 'var(--shadow-inset)',
        card: 'var(--shadow-raise)',
        glass: 'var(--shadow-float)',
      },
    },
  },
  plugins: [],
};

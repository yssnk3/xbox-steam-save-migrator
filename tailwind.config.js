/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        // Notion 的字体栈：优先系统 UI 字体
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Helvetica',
          '"Microsoft YaHei"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          '"SFMono-Regular"',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      colors: {
        // 全部走 CSS 变量：明暗主题与强调色由 index.css 的 :root / [data-theme] / [data-accent] 决定。
        // 组件里的 bg-ink-* / text-ink-* / border-ink-* 无需改动即可跟随主题。
        ink: {
          sidebar: 'var(--ink-sidebar)',
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
          hover: 'var(--hover-bg)',
          active: 'var(--active-bg)',
          success: 'var(--ink-success)',
          warning: 'var(--ink-warning)',
          danger: 'var(--ink-danger)',
          'xbox-to-steam': 'var(--ink-x2s)',
          'steam-to-xbox': 'var(--ink-s2x)',
        },
      },
      borderRadius: {
        // Notion 规范：控件 4px、卡片 6px、浮层 8px
        card: '6px',
        btn: '4px',
        modal: '8px',
      },
      boxShadow: {
        raise: 'none',
        inset: 'none',
        card: 'var(--shadow-card)',
        glass: 'var(--shadow-float)',
        menu: 'var(--shadow-menu)',
      },
      fontSize: {
        // 与 .t-* 阶梯对齐，供 Tailwind 侧使用
        'ui-sm': ['12px', { lineHeight: '18px' }],
        'ui-base': ['14px', { lineHeight: '21px' }],
        'ui-lg': ['16px', { lineHeight: '22px' }],
        'ui-xl': ['20px', { lineHeight: '26px' }],
      },
    },
  },
  plugins: [],
};
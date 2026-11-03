/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Microsoft YaHei"', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', '"Segoe UI"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        // 深色现代风语义 token —— 三层背景 / 三级文本 / 两级描边
        ink: {
          base: '#0B0B16',        // 页面底
          surface: '#14141F',     // 卡片 / 面板
          elevated: '#1C1C2C',    // 悬浮层 / 输入框 / hover
          raised: '#232338',      // 二级 hover / 分段控件选中
          text: '#E7E9F0',
          muted: '#8B8FA3',
          faint: '#5A5E72',
          border: '#262840',
          borderSoft: 'rgba(255,255,255,0.06)',
          accent: '#7C3AED',
          'accent-hover': '#8B5CF6',
          'accent-down': '#6D28D9',
          'accent-soft': 'rgba(124,58,237,0.12)',
          success: '#34D399',
          warning: '#FBBF24',
          danger: '#F43F5E',
          'xbox-to-steam': '#10B981',   // 方向按钮语义色（全 UI 唯一彩色按钮）
          'steam-to-xbox': '#38BDF8',
        },
      },
      borderRadius: {
        card: '8px',
        btn: '6px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
        'card-hover': '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
        glow: '0 0 0 1px rgba(255,255,255,0.10)',
        'glow-soft': '0 1px 2px rgba(0,0,0,0.4)',
        glass: '0 8px 32px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};

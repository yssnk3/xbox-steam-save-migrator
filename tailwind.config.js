/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        // 近单色工具风：中性灰阶为主，彩色只用于业务语义（方向按钮 / 状态点）
        ink: {
          base: '#0B0B16',
          surface: '#14141F',
          elevated: '#1C1C2C',
          raised: '#232338',
          text: '#E7E9F0',
          muted: '#8B8FA3',
          faint: '#5A5E72',
          border: '#262840',
          borderSoft: 'rgba(255,255,255,0.06)',
          // 主操作 = 亮底深字（Linear / Vercel 式），不再用彩色强调
          solid: '#E7E9F0',
          'solid-hover': '#FFFFFF',
          // 业务语义色：只在方向按钮和状态点上出现
          success: '#34D399',
          warning: '#FBBF24',
          danger: '#F43F5E',
          'xbox-to-steam': '#10B981',
          'steam-to-xbox': '#38BDF8',
        },
      },
      borderRadius: {
        card: '6px',
        btn: '4px',
      },
      boxShadow: {
        // 只保留一条极轻的描边替代阴影，层级靠边框和间距
        card: '0 0 0 1px rgba(255,255,255,0.04)',
        glass: '0 8px 32px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};

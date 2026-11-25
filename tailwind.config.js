export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
      },
      fontFamily: {
        editorial: ['"Noto Serif SC"', '"Songti SC"', 'SimSun', 'serif'],
        sans: ['"Noto Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['Consolas', 'monospace'],
      },
      fontSize: { body: ['15px', { lineHeight: '1.75' }] },
      borderRadius: { sm: '2px', md: '6px', lg: '10px' },
    },
  },
  plugins: [],
};

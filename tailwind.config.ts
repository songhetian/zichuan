import type { Config } from 'tailwindcss';

const config: Config = {
  // 应用主题是 class 驱动：`:root` 为亮色（默认），`:root.dark` 为暗色（按需覆盖）。
  // Tailwind 默认 darkMode='media' 只跟随「系统」偏好，与应用主题不同步
  // （系统暗 + 应用亮 → dark: 变体渲染错色）。用 'class' 绑定到 <html class="dark">。
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // 弹层遮罩：始终为压暗色（不随主题反转）
        overlay: 'hsl(var(--overlay))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // 语义色：DEFAULT=实色（图标/圆点/色条），soft*=状态胶囊（浅底 + 深字 + 柔和边）
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          soft: 'hsl(var(--destructive-soft))',
          'soft-foreground': 'hsl(var(--destructive-soft-foreground))',
          'soft-border': 'hsl(var(--destructive-soft-border))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
          'soft-foreground': 'hsl(var(--success-soft-foreground))',
          'soft-border': 'hsl(var(--success-soft-border))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
          'soft-foreground': 'hsl(var(--warning-soft-foreground))',
          'soft-border': 'hsl(var(--warning-soft-border))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          soft: 'hsl(var(--info-soft))',
          'soft-foreground': 'hsl(var(--info-soft-foreground))',
          'soft-border': 'hsl(var(--info-soft-border))',
        },
        violet: {
          DEFAULT: 'hsl(var(--violet))',
          foreground: 'hsl(var(--violet-foreground))',
          soft: 'hsl(var(--violet-soft))',
          'soft-foreground': 'hsl(var(--violet-soft-foreground))',
          'soft-border': 'hsl(var(--violet-soft-border))',
        },
        // 分类标识色：配件分类等「纯区分」用途，不承载状态语义
        cat: {
          indigo: 'hsl(var(--cat-indigo))',
          violet: 'hsl(var(--cat-violet))',
          blue: 'hsl(var(--cat-blue))',
          emerald: 'hsl(var(--cat-emerald))',
          sky: 'hsl(var(--cat-sky))',
          rose: 'hsl(var(--cat-rose))',
          cyan: 'hsl(var(--cat-cyan))',
          teal: 'hsl(var(--cat-teal))',
          purple: 'hsl(var(--cat-purple))',
          pink: 'hsl(var(--cat-pink))',
          fuchsia: 'hsl(var(--cat-fuchsia))',
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
          DEFAULT: 'hsl(var(--sidebar-bg))',
          foreground: 'hsl(var(--sidebar-fg))',
          active: 'hsl(var(--sidebar-active))',
          'active-foreground': 'hsl(var(--sidebar-active-fg))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Tailwind v3 内置的 aria-* 变体只有 busy / checked / disabled / expanded /
      // hidden / pressed / readonly / required / selected —— **没有 aria-invalid**。
      // 而表单错误态（react-hook-form 的 aria-invalid）依赖它，故在此显式注册。
      // 用法：aria-invalid:border-destructive（匹配 [aria-invalid="true"]）。
      aria: {
        invalid: 'invalid="true"',
      },
      keyframes: {
        // toast 自动消失倒计时（时长由 Radix duration 内联注入）
        'toast-progress': {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
      },
      animation: {
        'toast-progress': 'toast-progress linear forwards',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
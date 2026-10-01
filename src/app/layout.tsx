import type { Metadata } from "next"
import "./globals.css"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: {
    default: "雷犀资产管理系统",
    template: "%s | 雷犀资产管理",
  },
  description: "企业资产管理系统",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/*
          首帧无闪烁主题：SSR 默认渲染亮色（globals.css :root），
          暗色用户在刷新的第一帧会先看到白底。此脚本在绘制前
          同步读取 localStorage 并打上 .dark，消除刷新闪白。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{(function(){var t=localStorage.getItem("zt-theme");if(t==="dark"){document.documentElement.classList.add("dark")}})()}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

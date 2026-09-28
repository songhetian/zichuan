import type { Metadata } from "next"
import "./globals.css"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: "资产管理系统",
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
          首帧无闪烁主题：SSR 默认渲染暗色（globals.css :root），
          亮色用户在刷新的第一帧会先看到黑底。此脚本在绘制前
          同步读取 localStorage 并打上 .light，消除刷新闪黑。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{(function(){var t=localStorage.getItem("zt-theme");if(t==="light"){document.documentElement.classList.add("light")}})()}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

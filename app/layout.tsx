import type { Metadata } from 'next';
import './globals.css';
import './feed.css';
export const metadata:Metadata={title:'灵析 · 科技聚合报告',description:'一键检索科技资讯并生成聚合报告，用自然语言调整偏好，按需选择飞书、企业微信或邮件发送。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}

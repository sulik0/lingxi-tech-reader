import type { Metadata } from 'next';
import './globals.css';
import './feed.css';
export const metadata:Metadata={title:'灵析 · 个人科技信息流',description:'阅读聚合科技资讯，用自然语言调整偏好，查看飞书与企业微信机器人推送状态。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}

import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'灵析 · 科技聚合报告',description:'检索科技订阅，合并重复资讯，生成有事实、观点和原文链接的聚合报告，并推送飞书。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}

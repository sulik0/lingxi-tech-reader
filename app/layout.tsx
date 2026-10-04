import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'灵析 · 让信息回归价值',description:'面向科技公众号的事件聚合与交叉阅读工作台。看清事实、比较观点、找到值得读的一篇。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}

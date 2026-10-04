import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'灵析 · 让信息回归价值',description:'把报道同一件事的科技公众号文章放在一起，比较事实和观点，找到最值得读的一篇。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}

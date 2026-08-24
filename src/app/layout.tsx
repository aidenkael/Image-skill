import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '商品视觉工作台',
  description: 'SHEIN 类 AI 商品视觉工作台 V1：氛围感主图 + 组合卖点图',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

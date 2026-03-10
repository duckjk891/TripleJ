import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MiniHompi - Your Personal Space',
  description: 'Create and customize your own mini homepage',
  keywords: ['minihompi', 'cyworld', 'personal homepage', 'social'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Noto Sans KR - Korean font support */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

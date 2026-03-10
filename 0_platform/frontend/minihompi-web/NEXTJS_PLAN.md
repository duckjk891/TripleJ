# Next.js 14 Migration Plan for minihompi-web

## Overview

Migrate from Vite + React + react-router-dom to Next.js 14 with App Router.

**Current Stack:** Vite 6.x, React 18.3, react-router-dom 7.x, Phaser 3.70
**Target Stack:** Next.js 14, React 18.3, App Router, Phaser 3.70

---

## 1. New Folder Structure

```
frontend/minihompi-web/
├── app/
│   ├── layout.tsx              # Root layout (html, body, global providers)
│   ├── page.tsx                # MainPage (login/register) - route: /
│   ├── globals.css             # Global styles (merged from App.css)
│   ├── home/
│   │   ├── page.tsx            # HomePage (feed) - route: /home
│   │   └── page.module.css     # HomePage styles
│   ├── [username]/
│   │   ├── layout.tsx          # Profile layout (navbar, footer, BGM)
│   │   ├── page.tsx            # Redirect to /[username]/diary
│   │   ├── diary/
│   │   │   └── page.tsx        # Diary tab
│   │   ├── photo/
│   │   │   └── page.tsx        # Photo gallery tab
│   │   ├── guestbook/
│   │   │   └── page.tsx        # Guestbook tab
│   │   ├── office/
│   │   │   └── page.tsx        # Office tab (Phaser game)
│   │   └── settings/
│   │       └── page.tsx        # Settings tab (owner only)
│   └── not-found.tsx           # Custom 404 page
├── components/
│   ├── ui/                     # Shared UI components
│   │   ├── BgmPlayer.tsx       # 'use client'
│   │   ├── ProfileCard.tsx
│   │   └── TabMenu.tsx
│   ├── diary/
│   │   ├── DiaryList.tsx       # 'use client'
│   │   └── DiaryWrite.tsx      # 'use client'
│   ├── photo/
│   │   └── PhotoGallery.tsx    # 'use client'
│   ├── guestbook/
│   │   └── GuestBook.tsx       # 'use client'
│   ├── office/
│   │   ├── Office.tsx          # 'use client' - wrapper
│   │   └── PhaserGame.tsx      # 'use client' - dynamic import
│   ├── settings/
│   │   └── Settings.tsx        # 'use client'
│   └── game/                   # Phaser game (unchanged structure)
│       ├── bridge/
│       │   └── GameBridge.ts
│       ├── config/
│       │   ├── gameConfig.ts
│       │   ├── officeMapData.ts
│       │   └── worldTree.ts
│       ├── entities/
│       │   └── Character.ts
│       ├── scenes/
│       │   ├── OfficeScene.ts
│       │   └── OfficeUIScene.ts
│       ├── services/
│       │   └── api.ts
│       ├── systems/
│       │   ├── CharacterManager.ts
│       │   ├── GameTimeManager.ts
│       │   └── MapRenderer.ts
│       └── types/
│           └── index.ts
├── lib/
│   ├── api.ts                  # Axios API client (from src/api/index.ts)
│   └── auth.ts                 # Auth utilities (localStorage helpers)
├── hooks/
│   ├── useAuth.ts              # Auth state hook
│   └── useUser.ts              # User data fetching hook
├── types/
│   └── index.ts                # Shared TypeScript types
├── public/
│   └── assets/                 # Static assets (game sprites, etc.)
├── next.config.js              # Next.js configuration
├── package.json
├── tsconfig.json
└── .env.local                  # Environment variables
```

---

## 2. Key File Mappings

| Old Path (Vite)                          | New Path (Next.js)                        | Notes                           |
| ---------------------------------------- | ----------------------------------------- | ------------------------------- |
| `src/main.tsx`                           | `app/layout.tsx`                          | Root entry point                |
| `src/App.tsx`                            | _(deleted - routing via folder structure)_| App Router handles routing      |
| `src/App.css`                            | `app/globals.css`                         | Global styles                   |
| `src/pages/MainPage.tsx`                 | `app/page.tsx`                            | Login page at /                 |
| `src/pages/MainPage.css`                 | `app/page.module.css`                     | Module CSS                      |
| `src/pages/HomePage.tsx`                 | `app/home/page.tsx`                       | Home feed at /home              |
| `src/pages/HomePage.css`                 | `app/home/page.module.css`                | Module CSS                      |
| `src/pages/UserProfile.tsx`              | `app/[username]/layout.tsx` + pages       | Split into layout + tab pages   |
| `src/pages/UserProfile.css`              | `app/[username]/layout.module.css`        | Module CSS                      |
| `src/components/DiaryList.tsx`           | `components/diary/DiaryList.tsx`          | Add 'use client'                |
| `src/components/DiaryWrite.tsx`          | `components/diary/DiaryWrite.tsx`         | Add 'use client'                |
| `src/components/PhotoGallery.tsx`        | `components/photo/PhotoGallery.tsx`       | Add 'use client'                |
| `src/components/GuestBook.tsx`           | `components/guestbook/GuestBook.tsx`      | Add 'use client'                |
| `src/components/Office.tsx`              | `components/office/Office.tsx`            | Add 'use client'                |
| `src/components/PhaserGame.tsx`          | `components/office/PhaserGame.tsx`        | Dynamic import, no SSR          |
| `src/components/Settings.tsx`            | `components/settings/Settings.tsx`        | Add 'use client'                |
| `src/components/BgmPlayer.tsx`           | `components/ui/BgmPlayer.tsx`             | Add 'use client'                |
| `src/components/game/*`                  | `components/game/*`                       | No changes needed               |
| `src/api/index.ts`                       | `lib/api.ts`                              | Keep axios, add env var support |

---

## 3. Phaser Handling Strategy

Phaser uses browser-only APIs (canvas, WebGL, etc.) and must be loaded client-side only.

### 3.1 Dynamic Import with SSR Disabled

Create a client-only wrapper for the Phaser game:

```tsx
// components/office/PhaserGameWrapper.tsx
'use client';

import dynamic from 'next/dynamic';

const PhaserGame = dynamic(
  () => import('./PhaserGame'),
  {
    ssr: false,
    loading: () => (
      <div className="game-loading">
        <p>Loading game...</p>
      </div>
    )
  }
);

export default PhaserGame;
```

### 3.2 PhaserGame Component

```tsx
// components/office/PhaserGame.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { OfficeScene } from '../game/scenes/OfficeScene';
import { OfficeUIScene } from '../game/scenes/OfficeUIScene';
// ... rest of the component (mostly unchanged)
```

### 3.3 Office Page Usage

```tsx
// app/[username]/office/page.tsx
import PhaserGameWrapper from '@/components/office/PhaserGameWrapper';

export default function OfficePage() {
  return (
    <div className="office-container">
      <PhaserGameWrapper />
    </div>
  );
}
```

### 3.4 Important Notes

- All Phaser-related imports must be inside client components
- The `dynamic()` import with `ssr: false` prevents server-side rendering
- Game config and scenes remain unchanged
- GameBridge singleton pattern works fine in client components

---

## 4. Package.json Changes

### 4.1 Remove

```json
{
  "dependencies": {
    "react-router-dom": "^7.13.1"  // REMOVE - Next.js has built-in routing
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",  // REMOVE
    "vite": "^6.0.5"                    // REMOVE
  }
}
```

### 4.2 Add

```json
{
  "dependencies": {
    "next": "^14.2.0"
  },
  "devDependencies": {
    "eslint-config-next": "^14.2.0"
  }
}
```

### 4.3 Update Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

### 4.4 Final package.json

```json
{
  "name": "@onecompany/minihompi-web",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "axios": "^1.13.5",
    "next": "^14.2.0",
    "phaser": "^3.70.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "eslint": "^9.17.0",
    "eslint-config-next": "^14.2.0",
    "typescript": "~5.6.3"
  }
}
```

---

## 5. Route Migration Details

### 5.1 URL Structure Preservation

| URL Pattern           | Vite Component    | Next.js File                    |
| --------------------- | ----------------- | ------------------------------- |
| `/`                   | MainPage          | `app/page.tsx`                  |
| `/home`               | HomePage          | `app/home/page.tsx`             |
| `/:username`          | UserProfile       | `app/[username]/page.tsx`       |
| `/:username/diary`    | UserProfile       | `app/[username]/diary/page.tsx` |
| `/:username/photo`    | UserProfile       | `app/[username]/photo/page.tsx` |
| `/:username/guestbook`| UserProfile       | `app/[username]/guestbook/page.tsx` |
| `/:username/office`   | UserProfile       | `app/[username]/office/page.tsx`|
| `/:username/settings` | UserProfile       | `app/[username]/settings/page.tsx` |

### 5.2 Legacy Route Handling

For `/hompi/:userId/*` redirects, use Next.js middleware:

```tsx
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy /hompi/:userId/* -> /:username/*
  if (pathname.startsWith('/hompi/')) {
    const newPath = pathname.replace('/hompi/', '/');
    return NextResponse.redirect(new URL(newPath, request.url));
  }
}

export const config = {
  matcher: '/hompi/:path*',
};
```

---

## 6. Migration Steps (Execution Order)

### Phase 1: Project Setup (Day 1)
1. Create new Next.js 14 project alongside existing code
2. Set up folder structure
3. Configure `next.config.js`
4. Set up environment variables (`.env.local`)

### Phase 2: Core Infrastructure (Day 1-2)
5. Migrate `lib/api.ts` (axios client)
6. Create root `app/layout.tsx`
7. Create `app/globals.css`
8. Set up TypeScript paths in `tsconfig.json`

### Phase 3: Static Pages (Day 2)
9. Migrate `MainPage` -> `app/page.tsx`
10. Migrate `HomePage` -> `app/home/page.tsx`
11. Convert `useNavigate()` to `useRouter()` from `next/navigation`
12. Convert `Link` from `react-router-dom` to `next/link`

### Phase 4: Dynamic Routes (Day 2-3)
13. Create `app/[username]/layout.tsx` (profile shell)
14. Create `app/[username]/page.tsx` (redirect to diary)
15. Migrate each tab as separate page:
    - `diary/page.tsx`
    - `photo/page.tsx`
    - `guestbook/page.tsx`
    - `settings/page.tsx`
16. Convert `useParams()` to Next.js params

### Phase 5: Phaser Integration (Day 3)
17. Create `PhaserGameWrapper.tsx` with dynamic import
18. Copy game folder to `components/game/`
19. Create `app/[username]/office/page.tsx`
20. Test game rendering and functionality

### Phase 6: Polish & Testing (Day 4)
21. Add middleware for legacy routes
22. Add loading states (`loading.tsx` files)
23. Add error boundaries (`error.tsx` files)
24. Test all routes and functionality
25. Remove Vite config files

---

## 7. Key Code Patterns

### 7.1 Client Components

```tsx
// Any component using hooks, browser APIs, or interactivity
'use client';

import { useState, useEffect } from 'react';
// ...
```

### 7.2 Navigation Changes

```tsx
// OLD (react-router-dom)
import { useNavigate, useParams, Link } from 'react-router-dom';
const navigate = useNavigate();
navigate('/home');

// NEW (next/navigation, next/link)
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
const router = useRouter();
router.push('/home');
```

### 7.3 Dynamic Route Params

```tsx
// OLD
const { username } = useParams<{ username: string }>();

// NEW (in page component)
export default function Page({ params }: { params: { username: string } }) {
  const { username } = params;
}

// NEW (in client component)
'use client';
import { useParams } from 'next/navigation';
const params = useParams<{ username: string }>();
```

### 7.4 Environment Variables

```tsx
// .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000

// lib/api.ts
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});
```

---

## 8. next.config.js

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode
  reactStrictMode: true,

  // Configure image domains if needed
  images: {
    domains: ['localhost'],
  },

  // Transpile Phaser (if needed)
  transpilePackages: ['phaser'],

  // Webpack config for Phaser
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Phaser requires these to be available
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
```

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Phaser SSR errors | High | Use `dynamic()` with `ssr: false` |
| localStorage on server | Medium | Guard with `typeof window !== 'undefined'` |
| Route param differences | Low | Test all dynamic routes thoroughly |
| CSS module naming conflicts | Low | Rename CSS classes during migration |
| Build size increase | Low | Use `next/dynamic` for code splitting |

---

## 10. Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Setup + Infrastructure | 1 day | Project scaffold, api client |
| Static Pages | 0.5 day | MainPage, HomePage working |
| Dynamic Routes | 1 day | All user profile tabs |
| Phaser Integration | 0.5 day | Office game working |
| Testing & Polish | 1 day | Full QA, legacy redirects |
| **Total** | **4 days** | Production-ready Next.js app |

---

## Appendix: Files to Delete After Migration

- `vite.config.ts`
- `src/main.tsx`
- `src/App.tsx`
- `src/App.css`
- `src/pages/` (entire folder)
- `index.html`

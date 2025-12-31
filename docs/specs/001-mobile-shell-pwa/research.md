# Research: Web Mobile-Comparable + PWA

**Feature**: `001-mobile-shell-pwa`  
**Date**: 2025-12-28

## Decision 1: PWA approach (Next.js App Router)

**Decision**: Use Next.js built-in **manifest support** (`app/manifest.ts`) + a simple **service worker** served from `public/sw.js` for asset caching.

**Rationale**:
- Next.js documents first-class manifest support in App Router via `app/manifest.ts`.
- A small `public/sw.js` is enough for MVP: “instalável + abrir UI”, without claiming offline data.
- Minimizes dependency risk vs. plugins that depend on webpack configuration or require more setup.

**Alternatives considered**:
- `next-pwa` plugin: convenient, but adds build/plugin coupling and has historically had compatibility caveats across Next major versions.
- Serwist/Workbox integrations: powerful for offline strategies, but heavier and better deferred until we explicitly need offline data behavior.

**Notes**:
- To be installable, we need HTTPS in production and valid manifest + icons.
- For local testing, Next docs recommend HTTPS dev mode for notification-related flows; for MVP we only need installability and can validate in staging over HTTPS.

## Decision 2: “Prompt automático” de instalação (cross-platform)

**Decision**: Rely on the browser’s native install prompt where it exists, and show an **automatic in-app banner** only when it’s both eligible and helpful:
- **Android/Chromium**: browser can show install prompt automatically when criteria met; optionally we can show a CTA that calls `beforeinstallprompt` only when supported.
- **iOS Safari**: `beforeinstallprompt` doesn’t work; show an automatic banner with “Add to Home Screen” instructions when not installed.

**Rationale**:
- The install prompt behavior is not uniform across browsers; Safari iOS requires a custom UX.
- Automatic in-app banner meets the product requirement (“não ficar escondido em settings”) while keeping compatibility.

**Alternatives considered**:
- Always forcing `beforeinstallprompt`: not cross-platform and can lead to inconsistent UX on iOS.

**State**:
- Persist “dismissed” state locally (per device) to avoid spamming users.

## Decision 3: BottomNav (mobile) + Rail (tablet) strategy

**Decision**: Adaptive navigation with explicit destinations:
- Mobile: BottomNav = Inbox, Boards, Contatos, Atividades, Mais
- Tablet: Navigation rail = same (icons)
- Desktop: existing sidebar remains

**Rationale**:
- Aligns with the product direction you confirmed: mobile-first + rail on tablet.
- Minimizes refactors inside features; focuses on shell-level navigation.

## Decision 4: Sheets for mobile “detail/edit” flows

**Decision**: Introduce a `Sheet`/`FullscreenSheet` primitive and use it for:
- Deal detail
- Create/edit (Activity/Contact/Deal)
- Filters

**Rationale**:
- Avoids modal breakage and stacking issues on small screens.
- Matches the “app-like” UX requirement.

## Gate Re-check (Constitution)

- Security/RLS: unchanged (client UI only)
- Public API contract: unchanged
- Mobile/tablet UX: primary focus, validated by QA viewports
- Changelog: will be updated when implementation starts (code changes) and before release

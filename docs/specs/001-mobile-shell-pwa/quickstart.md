# Quickstart: Validate Mobile-Comparable + PWA

**Feature**: `001-mobile-shell-pwa`  
**Date**: 2025-12-28

## Run locally

1) Install dependencies and start dev server:

```bash
npm install
npm run dev
```

2) Open the app and use device emulation:
- iPhone: 390×844 (Safari/Chrome)
- Android: 360×800
- iPad: 768×1024 and 1024×768

## Validate “golden tasks”

- Mobile navigation: switch Inbox/Boards/Contatos/Atividades without overlap
- Deal flow: open deal → move stage → mark won/lost
- Activity: create + complete an activity without keyboard hiding CTA
- PWA: install prompt appears (eligible browsers) and app launches from home screen

## QA checklist (must-pass)

### Desktop regression (>=1280px)

- Sidebar (desktop) remains visible and behaves as before (collapse/expand).
- Deal detail keeps opening as the existing modal (no sheet).
- No new banners/nav elements cover content on desktop (Install banner should be dismissible and not break layout).

### RBAC quick pass (admin vs vendedor)

- As **admin**: confirm you can access Settings/Reports (and that “Mais” exposes these destinations on mobile/tablet).
- As **vendedor**: confirm restricted areas behave as before (UI hidden/blocked + server returns 403 where applicable).

### Network error feedback

- Simulate offline (DevTools → Network → Offline) and open Inbox/Boards:
  - UI should not hard-crash; show a reasonable error/toast.
- Reload while offline: app shell should still load (service worker cache best-effort), but data fetches can fail gracefully.

### Activity complete (mobile)

- From deal detail (mobile sheet), create a new activity and then mark it **completed**.
- Confirm keyboard does not hide the submit CTA; scrolling within modal/sheet remains possible.

### Performance sanity (mobile)

- Scroll Inbox list and Boards list: no obvious jank; opening/closing sheet feels responsive.

## PWA notes

- PWA installation requires:
  - valid manifest
  - served over HTTPS (production/staging)
- iOS behavior differs:
  - no standard `beforeinstallprompt`
  - user installs via “Share → Add to Home Screen”
  - our banner should re-appear only after 7 days if dismissed

# Data Model: Web Mobile-Comparable + PWA

**Feature**: `001-mobile-shell-pwa`  
**Date**: 2025-12-28

> This feature does not introduce new server-side entities. The “data model” here describes **UI state** and its persistence.

## Entities (UI)

### NavigationDestination

Represents a primary area of the CRM shown in adaptive navigation.

- `id`: string (e.g., `inbox`, `boards`, `contacts`, `activities`, `more`)
- `label`: string
- `route`: string (path)
- `icon`: UI icon reference
- `badgeCount`: number (optional, derived)

### ResponsiveBreakpoint

Represents a layout mode derived from viewport.

- `mode`: `mobile | tablet | desktop`
- `breakpoints`: derived from CSS/Tailwind (implementation detail), but the domain concept is stable.

### SheetFlow

Represents a mobile-first “overlay flow” for detail/edit.

- `type`: `dealDetail | activityEdit | contactEdit | filters | moreMenu | ...`
- `entityId`: string (optional, e.g., dealId)
- `isOpen`: boolean
- `returnTo`: route/state (optional)

### InstallState (PWA)

Represents whether the install CTA/banner should be shown.

- `isStandalone`: boolean (installed/run in standalone display mode)
- `isIOS`: boolean (user agent capability bucket)
- `isEligible`: boolean (heuristic; e.g., manifest available + https + not standalone)
- `dismissedUntil`: timestamp (optional)

## Persistence

### Local-only persistence (per device)

- Install banner dismissal: stored locally to avoid repeated prompts.
- Non-critical UI preferences may also be stored locally (if needed), but user-level preferences should remain in `user_settings` when they affect product behavior across devices.

## Relationships / Derived Data

- `badgeCount` derives from existing domain data (e.g., pending activities, inbox items), not a new persisted entity.

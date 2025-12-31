---

description: "Task list for 001-mobile-shell-pwa"
---

# Tasks: Web Mobile-Comparable + PWA

**Feature**: `001-mobile-shell-pwa`  
**Input**: Design documents from `specs/001-mobile-shell-pwa/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`  

**Tests**: Not requested in the feature specification; this tasks list focuses on implementation + manual QA.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Each task includes exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared primitives and conventions used by multiple user stories.

- [x] T001 Define responsive breakpoints/modes (mobile/tablet/desktop) in `lib/utils/responsive.ts`
- [x] T002 [P] Add a shared hook to read responsive mode in `hooks/useResponsiveMode.ts`
- [x] T003 [P] Define navigation destination config (ids, labels, routes) in `components/navigation/navConfig.ts`
- [x] T004 [P] Add safe-area utilities (CSS vars/classes) in `app/globals.css`
- [x] T005 Create `components/navigation/` directory structure and barrel exports in `components/navigation/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core UX building blocks required before any user story work can be completed.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T006 Implement a minimal Sheet primitive (base layer) in `components/ui/Sheet.tsx`
- [x] T007 [P] Create `components/ui/FullscreenSheet.tsx` preset (header/body/footer layout) in `components/ui/FullscreenSheet.tsx`
- [x] T008 [P] Add accessibility helpers for overlays (focus, escape, aria) in `lib/a11y/overlay.ts`
- [x] T009 [P] Define a shared “modal vs sheet” decision helper in `lib/utils/isMobile.ts`
- [x] T010 Ensure modal overlay patterns remain consistent with app shell layout in `components/ui/modalStyles.ts` (criteria: overlays respect `--app-sidebar-width` on desktop and never cover BottomNav safe-area on mobile; validate against top overlays: Deal detail, cockpit panels, confirm modal)

**Checkpoint**: Shared primitives exist (responsive mode + navigation config + sheet base). User stories can proceed.

---

## Phase 3: User Story 1 - Mobile app shell navigation (Priority: P1) 🎯 MVP

**Goal**: Provide bottom navigation on mobile that prevents overlap and enables 1–2 tap switching between main areas.

**Independent Test**: In 390×844 and 360×800 viewports, user can switch Inbox/Boards/Contatos/Atividades without overlay/covering CTAs.

### Implementation for User Story 1

- [x] T011 [P] [US1] Implement BottomNav UI in `components/navigation/BottomNav.tsx`
- [x] T012 [P] [US1] Implement “More” menu sheet in `components/navigation/MoreMenuSheet.tsx`
- [x] T013 [US1] Wire BottomNav into shell (mobile only) in `components/Layout.tsx`
- [x] T014 [US1] Ensure content layout accounts for BottomNav height (padding) in `components/Layout.tsx`
- [x] T015 [US1] Ensure mobile routes are reachable and consistent with navConfig in `components/navigation/navConfig.ts`
- [x] T016 [P] [US1] Add basic badges wiring stubs (optional counts) in `components/navigation/BottomNav.tsx`

### Manual QA for User Story 1

- [x] T017 [US1] Verify 390×844: navigate Inbox→Boards→Contatos→Atividades; confirm no overlap (use `specs/001-mobile-shell-pwa/quickstart.md`)
- [x] T018 [US1] Verify 360×800: scroll long lists and confirm CTAs not covered by BottomNav (Inbox + Boards)
- [x] T019 [US1] Verify keyboard focus/escape does not break navigation when overlays exist (open/close “Mais”)
- [x] T020 [US1] Verify desktop (>=1280px): existing sidebar + navigation behavior unchanged after US1

**Checkpoint**: Mobile navigation is “app-like” and stable; no layout overlaps.

---

## Phase 4: User Story 2 - Deal flow in mobile Sheet (Priority: P2)

**Goal**: Deal detail opens as fullscreen sheet on mobile, enabling stage move and mark won/lost without broken modals.

**Independent Test**: On mobile viewport, open deal from Boards and complete “move stage” in < 60s, with keyboard not hiding CTAs.

### Implementation for User Story 2

- [x] T021 [P] [US2] Create DealSheet wrapper view in `features/boards/components/DealSheet.tsx`
- [x] T022 [US2] Refactor Deal detail entry point to choose modal vs sheet by breakpoint in `features/boards/components/Modals/DealDetailModal.tsx`
- [x] T023 [US2] Wire Boards item click to open DealSheet on mobile in `features/boards/components/PipelineView.tsx`
- [x] T024 [US2] Ensure stage move action is accessible without drag in mobile view in `features/boards/components/Kanban/KanbanList.tsx`
- [x] T025 [US2] Ensure mark won/lost actions are reachable in DealSheet in `features/boards/components/DealSheet.tsx`
- [x] T026 [US2] Ensure Activity create flow from Deal works in sheet context in `features/activities/components/ActivityFormModal.tsx`
- [x] T027 [US2] Ensure sheet close/back returns to originating context without losing selection in `features/boards/components/PipelineView.tsx`

### Manual QA for User Story 2

- [x] T028 [US2] In 390×844, open a deal → move stage → verify UI updates (Boards list-first + deal detail)
- [x] T029 [US2] In 390×844, open a deal → mark won/lost → verify UI reflects state
- [x] T030 [US2] In 390×844, open deal → create an activity → verify keyboard does not hide submit CTA
- [x] T031 [US2] Verify desktop (>=1280px): deal detail and actions behave unchanged (no sheet shown on desktop)

**Checkpoint**: Deal flow is fully usable on mobile via sheet.

---

## Phase 5: User Story 3 - PWA installable + automatic prompt (Priority: P3)

**Goal**: Make the CRM installable as a PWA and show an automatic install CTA when eligible (with iOS-specific instructions).

**Independent Test**: On eligible browser, user sees install CTA automatically and can launch CRM from home screen.

### Implementation for User Story 3

- [x] T032 [US3] Create web app manifest in `app/manifest.ts`
- [x] T033 [P] [US3] Add PWA icons to `public/` (MVP uses SVG): `public/icons/icon.svg`, `public/icons/maskable.svg`
- [x] T034 [US3] Create service worker for asset caching (MVP) in `public/sw.js`
- [x] T035 [US3] Register service worker via a dedicated client component `components/pwa/ServiceWorkerRegister.tsx` and mount it from `app/layout.tsx`
- [x] T036 [US3] Implement install eligibility detection and “standalone” detection in `components/pwa/useInstallState.ts`
- [x] T037 [US3] Implement automatic install banner/CTA (cross-platform) in `components/pwa/InstallBanner.tsx`
- [x] T038 [US3] Persist banner dismissal per device in `components/pwa/useInstallState.ts`
- [x] T039 [US3] Add headers for `sw.js` (no-cache, correct content-type) in `next.config.ts`

### Manual QA for User Story 3

- [x] T040 [US3] Verify manifest is served and contains icons (check browser Application tab) using `specs/001-mobile-shell-pwa/quickstart.md`)
- [x] T041 [US3] Verify automatic banner appears when eligible and disappears after dismiss/install (Android Chrome + iOS Safari guidance)
- [x] T042 [US3] Verify app launches in standalone display mode after install and navigation works
- [x] T043 [US3] Verify desktop (>=1280px): no UI regressions caused by PWA changes (shell/navigation unchanged)

**Checkpoint**: PWA installation flow works and does not spam users.

---

## Phase 6: User Story 4 - Tablet navigation rail (Priority: P4)

**Goal**: On tablet, show a navigation rail that provides app-like navigation without stealing content space.

**Independent Test**: On 768×1024 and 1024×768, rail appears and user can switch areas without overlap/compression issues.

### Implementation for User Story 4

- [x] T044 [P] [US4] Implement NavigationRail UI in `components/navigation/NavigationRail.tsx`
- [x] T045 [US4] Integrate rail into shell for tablet breakpoints in `components/Layout.tsx`
- [x] T046 [US4] Ensure desktop sidebar behavior is preserved and does not conflict with rail in `components/Layout.tsx`
- [x] T047 [US4] Ensure rail respects existing overlay positioning (`--app-sidebar-width`) expectations in `components/Layout.tsx`

### Manual QA for User Story 4

- [x] T048 [US4] Verify 768×1024: rail visible; navigate between areas; no overlap
- [x] T049 [US4] Verify 1024×768: rail visible; content remains readable; overlays still align
- [x] T050 [US4] Verify desktop (>=1280px): sidebar remains and rail does not appear

**Checkpoint**: Tablet feels “native-like” and stable.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [x] T051 Add a11y pass for navigation and sheets (focus order, escape, aria labels) in `components/navigation/*` and `components/ui/*`
- [x] T052 Add consistent loading/skeleton states where mobile flows feel “blank” in `features/inbox/*` and `features/boards/*`
- [x] T053 Identify and fix any horizontal overflow regressions (global + per feature) in `app/globals.css` and relevant feature components
- [x] T054 Update `docs/changelog.md` with a dated entry once implementation begins (mobile shell + sheets + PWA)
- [x] T055 Add explicit RBAC QA for mobile flows (admin vs vendedor) in `specs/001-mobile-shell-pwa/quickstart.md` (navigation + deal actions + activity create/complete)
- [x] T056 Add explicit “network error” QA scenarios (offline/failed fetch) in `specs/001-mobile-shell-pwa/quickstart.md` and verify error messages are user-friendly in Inbox/Boards/DealSheet
- [x] T057 Add a “complete activity” validation step for mobile (not only create) in `specs/001-mobile-shell-pwa/quickstart.md`
- [x] T058 Define a single source of truth for breakpoint checks: `hooks/useResponsiveMode.ts` returns `mobile|tablet|desktop`; `lib/utils/isMobile.ts` MUST depend on that mode (no duplicate media logic)
- [x] T059 Add a lightweight performance validation task (profile scroll/animations) in `specs/001-mobile-shell-pwa/quickstart.md` for Inbox and Boards lists (goal: no jank perceptible on common mobile devices)

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (Setup) → Phase 2 (Foundational) → US1 → US2 → US3 → US4 → Polish
- US3 depends on US1 only (for the “app-like” shell), but can be started after Phase 2 if staffed in parallel.

### Parallel Opportunities

- Tasks marked **[P]** can be executed in parallel once their dependencies exist (different files).

---

## Parallel Example: User Story 1

```bash
# Parallelizable tasks (different files):
# - T011 BottomNav (components/navigation/BottomNav.tsx)
# - T012 MoreMenuSheet (components/navigation/MoreMenuSheet.tsx)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2
2. Implement US1 (BottomNav + shell integration)
3. Validate golden tasks for navigation on mobile viewports

### Incremental Delivery

1. US1 → demo
2. US2 → demo (deal flow)
3. US3 → demo (PWA install)
4. US4 → demo (tablet rail)
5. Polish

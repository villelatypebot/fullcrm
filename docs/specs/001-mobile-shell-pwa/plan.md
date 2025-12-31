# Implementation Plan: Web Mobile-Comparable + PWA

**Branch**: `001-mobile-shell-pwa` | **Date**: 2025-12-28 | **Spec**: `specs/001-mobile-shell-pwa/spec.md`
**Input**: Feature specification from `specs/001-mobile-shell-pwa/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Transformar o NossoCRM web em uma experiência **mobile/tablet comparável a app** (sem app nativo), entregando:
- **Mobile**: bottom navigation + flows core em **Fullscreen Sheets**
- **Tablet**: **navigation rail**
- **Boards**: mobile-first (list por estágio) e ações essenciais do deal
- **PWA**: instalável com **prompt automático** (com UX adequada para iOS/Android)

A abordagem prioriza mudanças no **app shell** e padronização de overlays/sheets, mantendo o backend e os dados existentes.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (TypeScript 5.x), React 19.2.1, Next.js 16.x  
**Primary Dependencies**: Next.js (App Router), Supabase (Auth/Postgres/RLS), TanStack Query, Tailwind CSS, Radix UI  
**Storage**: Supabase Postgres (primary); client-side localStorage/sessionStorage only for UX state when needed  
**Testing**: Vitest + Testing Library (existing)  
**Target Platform**: Web (mobile/tablet/desktop browsers) + PWA installable experience  
**Project Type**: Web application (single Next.js repo with `app/`, `features/`, `components/`, `lib/`)  
**Performance Goals**: Navegação “instantânea” percebida e interações a 60fps em listas/overlays; reduzir jank em mobile  
**Constraints**: Não quebrar desktop; manter RLS/tenant; minimizar mudanças server-side; offline de dados fora do MVP  
**Scale/Scope**: Foco nos fluxos core (Inbox/Boards/Contatos/Atividades + Deal detail); rollout incremental por feature flags quando útil

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Security/RLS**: any data access MUST respect tenant isolation (`organization_id`) and Supabase RLS.
- **API contracts**: if Public API (`app/api/public/v1/*`) changes, OpenAPI MUST be updated and backwards compatibility reviewed.
- **Mobile/tablet UX**: if UI changes, verify responsive behavior (mobile + tablet) and prefer sheets over heavy modals on mobile.
- **Docs/Changelog**: significant changes MUST update `docs/changelog.md` (DD/MM/AAAA + summary + technical notes).

Source of truth: `.specify/memory/constitution.md`.

## Project Structure

### Documentation (this feature)

```text
specs/001-mobile-shell-pwa/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
app/
├── (protected)/
├── api/
├── globals.css
└── layout.tsx

components/
├── Layout.tsx
├── ui/
└── (new) navigation/

features/
├── inbox/
├── boards/
├── contacts/
├── activities/
└── settings/

lib/
├── supabase/
└── query/

public/
└── (new) pwa icons + sw.js
```

**Structure Decision**: Manter o repo como “single Next.js app”. A feature será implementada via componentes novos (`components/navigation/*`, `components/ui/Sheet*`), ajustes no shell (`components/Layout.tsx`) e adaptações incrementais em `features/*`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | No constitution violations anticipated for this plan | N/A |

## Phase 0: Research & Decisions (output: research.md)

Research focuses on:
- PWA approach for Next.js 16 App Router (manifest + service worker)
- Install prompt behavior across iOS/Android/desktop
- Sheet UX patterns compatible with existing modal architecture

See `research.md` for decisions and alternatives.

## Phase 1: Design Artifacts (output: data-model.md, contracts/, quickstart.md)

- `data-model.md`: UI state entities (navigation destinations, install state, sheet flows)
- `contracts/`: no new server API contracts for MVP; document that explicitly
- `quickstart.md`: how to validate mobile/tablet + PWA locally

## Phase 2: Implementation Outline (high-level)

- Add adaptive navigation (BottomNav / Rail) with safe-area
- Introduce Sheet system and migrate Deal/Activity/Contact flows on mobile
- Boards: list-first on mobile + no-drag stage move
- PWA MVP: manifest, icons, service worker (assets), automatic prompt/banner UX
- Verify constitution gates: RLS unaffected, no Public API changes, changelog updates when code rollout begins

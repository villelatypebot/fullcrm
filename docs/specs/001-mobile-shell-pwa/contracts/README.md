# Contracts: Web Mobile-Comparable + PWA

**Feature**: `001-mobile-shell-pwa`  
**Date**: 2025-12-28

## Server/API Contracts

This feature does **not** introduce new server-side endpoints or modify Public API routes.

All data reads/writes continue to use the existing authenticated user session and existing domain services.

If, during implementation, we decide to add endpoints for composite operations or PWA push notifications, those MUST be specified here and (for Public API) reflected in OpenAPI.

## Client Contracts (UI)

- Navigation destinations (Inbox/Boards/Contatos/Atividades/Mais) must remain stable for user mental model.
- Sheet flows must provide consistent close/back behavior and preserve context when returning to the originating screen.

// Setup específico para testes com DOM (React Testing Library, etc.)
// Importa matchers do jest-dom apenas quando existe `document`.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const hasDom = typeof document !== 'undefined'

if (hasDom) {
  // Alguns helpers (ex: @testing-library/user-event) esperam `window`/`navigator`
  // disponíveis na "view" atual.
  if (typeof (globalThis as any).window === 'undefined') {
    ;(globalThis as any).window = globalThis
  }

  if (typeof (globalThis as any).navigator === 'undefined') {
    ;(globalThis as any).navigator = { userAgent: 'vitest' }
  }

  // Top-level await é suportado neste projeto (ESM). Em ambiente node puro, `hasDom` é false.
  await import('@testing-library/jest-dom/vitest')

  // Ajuda a evitar warnings do React sobre act() em alguns cenários.
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
}

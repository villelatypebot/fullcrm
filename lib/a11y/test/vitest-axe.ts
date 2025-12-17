import type { AxeResults } from 'axe-core';

declare module 'vitest' {
  interface Assertion<T> {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}

export {};

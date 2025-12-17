import './vitest-axe';
import { axe, configureAxe } from 'vitest-axe';
import { expect } from 'vitest';
import type { RenderResult } from '@testing-library/react';

// Re-export the default axe for simple usage
export { axe };

// Configure axe with sensible defaults for component testing
export const configuredAxe = configureAxe({
  rules: {
    // Disable color-contrast in tests (hard to test accurately in JSDOM)
    'color-contrast': { enabled: false },
    // Ensure region rule doesn't fail for isolated component tests
    region: { enabled: false },
  },
});

/**
 * Test a rendered component for accessibility violations
 * 
 * @example
 * ```tsx
 * it('should have no accessibility violations', async () => {
 *   const { container } = render(<MyComponent />);
 *   await expectNoA11yViolations(container);
 * });
 * ```
 */
export async function expectNoA11yViolations(
  container: Element | RenderResult['container']
): Promise<void> {
  const results = await axe(container);
  expect(results).toHaveNoViolations();
}

/**
 * Test for specific ARIA attributes
 */
export function expectAriaLabel(element: HTMLElement, label: string): void {
  expect(element).toHaveAttribute('aria-label', label);
}

export function expectAriaLabelledBy(element: HTMLElement, id: string): void {
  expect(element).toHaveAttribute('aria-labelledby', id);
}

export function expectAriaDescribedBy(element: HTMLElement, id: string): void {
  expect(element).toHaveAttribute('aria-describedby', id);
}

export function expectRole(element: HTMLElement, role: string): void {
  expect(element).toHaveAttribute('role', role);
}

export function expectFocusable(element: HTMLElement): void {
  expect(element.tabIndex).toBeGreaterThanOrEqual(0);
}

export function expectNotFocusable(element: HTMLElement): void {
  expect(element.tabIndex).toBe(-1);
}

/**
 * Check if element is visually hidden but accessible
 */
export function expectVisuallyHidden(element: HTMLElement): void {
  const styles = window.getComputedStyle(element);
  expect(
    element.classList.contains('sr-only') ||
    (styles.position === 'absolute' && styles.width === '1px')
  ).toBe(true);
}

/**
 * Test keyboard navigation
 */
export function simulateTab(shift = false): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: shift,
      bubbles: true,
    })
  );
}

export function simulateEscape(): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })
  );
}

export function simulateEnter(): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
    })
  );
}

export function simulateSpace(): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
    })
  );
}

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors));
}

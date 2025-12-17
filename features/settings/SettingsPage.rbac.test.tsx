import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useSearchParams: () => ({
    get: () => null,
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./hooks/useSettingsController', () => ({
  useSettingsController: () => ({
    defaultRoute: '/boards',
    setDefaultRoute: vi.fn(),

    customFieldDefinitions: [],
    newFieldLabel: '',
    setNewFieldLabel: vi.fn(),
    newFieldType: 'text',
    setNewFieldType: vi.fn(),
    newFieldOptions: '',
    setNewFieldOptions: vi.fn(),
    editingId: null,
    startEditingField: vi.fn(),
    cancelEditingField: vi.fn(),
    handleSaveField: vi.fn(),
    removeCustomField: vi.fn(),

    availableTags: ['VIP'],
    newTagName: '',
    setNewTagName: vi.fn(),
    handleAddTag: vi.fn(),
    removeTag: vi.fn(),
  }),
}))

// Evita precisar de providers (CRMContext/ToastContext) no teste.
vi.mock('./components/AIConfigSection', () => ({
  AIConfigSection: () => <div>AI_CONFIG_SECTION</div>,
}))

import SettingsPage from './SettingsPage'
import { useAuth } from '@/context/AuthContext'

const useAuthMock = vi.mocked(useAuth)

describe('SettingsPage RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('vendedor não vê seções de configuração do sistema', () => {
    useAuthMock.mockReturnValue({
      profile: { role: 'vendedor' },
    } as any)

    render(<SettingsPage />)

    expect(
      screen.queryByRole('heading', { name: /^Gerenciamento de Tags$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /^Campos Personalizados$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /^Chaves de API$/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Webhooks$/i })).not.toBeInTheDocument()

    // Preferências pessoais seguem visíveis
    expect(screen.getByText('AI_CONFIG_SECTION')).toBeInTheDocument()
    expect(screen.getByText(/página inicial/i)).toBeInTheDocument()
  })

  it('admin vê seções de configuração do sistema', () => {
    useAuthMock.mockReturnValue({
      profile: { role: 'admin' },
    } as any)

    render(<SettingsPage />)

    expect(
      screen.getByRole('heading', { name: /^Gerenciamento de Tags$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /^Campos Personalizados$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /^Chaves de API$/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Webhooks$/i })).toBeInTheDocument()

    expect(screen.getByText('AI_CONFIG_SECTION')).toBeInTheDocument()
  })
})

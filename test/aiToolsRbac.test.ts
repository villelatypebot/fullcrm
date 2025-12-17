import { beforeEach, describe, expect, it, vi } from 'vitest'

const profileQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({
    data: { first_name: 'Maria', nickname: null },
    error: null,
  })),
}

const dealsQueryBuilder = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({
    data: { title: 'Negócio X' },
    error: null,
  })),
}

// Mock do client service-role usado pelo agente de IA.
const supabaseMock = {
  from: vi.fn((table: string) => {
    if (table === 'profiles') return profileQueryBuilder
    if (table === 'deals') return dealsQueryBuilder
    throw new Error(`Unexpected table: ${table}`)
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => supabaseMock,
}))

import { createCRMTools } from '@/lib/ai/tools'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AI Tools permissions', () => {
  it('permite assignDeal para vendedor (regra: vendedor só não mexe em usuários/configs)', async () => {
    const tools = createCRMTools(
      {
        organizationId: '11111111-1111-1111-1111-111111111111',
      },
      'user-1'
    )

    const res = await tools.assignDeal.execute({
      dealId: 'deal-1',
      newOwnerId: 'user-2',
    })

    expect(res).toMatchObject({
      success: true,
    })

    expect(supabaseMock.from).toHaveBeenCalledWith('profiles')
    expect(supabaseMock.from).toHaveBeenCalledWith('deals')
    expect(dealsQueryBuilder.update).toHaveBeenCalledTimes(1)
    expect(String((res as any).message)).toContain('Maria')
  })
})

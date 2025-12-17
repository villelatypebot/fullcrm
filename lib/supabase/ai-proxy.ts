/**
 * @fileoverview Cliente para Edge Function de IA (ai-proxy).
 * 
 * Este módulo fornece a interface para chamar o Edge Function ai-proxy,
 * que processa todas as requisições de IA de forma segura.
 * 
 * ## Segurança
 * 
 * Todas as chamadas de IA passam por esta Edge Function autenticada.
 * As chaves de API são armazenadas no servidor e nunca expostas ao frontend.
 * 
 * ## Compliance LGPD
 * 
 * Consentimento implícito: configurar uma API key = consentimento.
 * 
 * ## Rate Limiting
 * 
 * - 60 requisições por minuto
 * - 1000 requisições por dia
 * 
 * @module lib/supabase/ai-proxy
 * 
 * @example
 * ```typescript
 * import { callAIProxy, isConsentError, isRateLimitError } from '@/lib/supabase/ai-proxy';
 * 
 * try {
 *   const result = await callAIProxy('analyzeLead', { deal: {...} });
 * } catch (error) {
 *   if (isConsentError(error)) {
 *     // Mostrar modal de consentimento
 *   }
 *   if (isRateLimitError(error)) {
 *     // Mostrar aviso de rate limit
 *   }
 * }
 * ```
 */

'use client';

/**
 * Ações de IA disponíveis no proxy.
 * 
 * @typedef AIAction
 */
export type AIAction =
  | 'analyzeLead'
  | 'generateEmailDraft'
  | 'generateObjectionResponse'
  | 'generateDailyBriefing'
  | 'generateRescueMessage'
  | 'parseNaturalLanguageAction'
  | 'chatWithCRM'
  | 'generateBirthdayMessage'
  | 'generateBoardStructure'
  | 'generateBoardStrategy'
  | 'refineBoardWithAI'
  | 'chatWithBoardAgent'
  | 'generateSalesScript';

/**
 * Resposta padronizada do AI Proxy.
 * 
 * @interface AIProxyResponse
 * @template T Tipo do resultado esperado.
 * @property {T} [result] - Resultado da operação de IA.
 * @property {string} [error] - Mensagem de erro, se houver.
 * @property {string} [consentType] - Tipo de consentimento necessário.
 * @property {number} [retryAfter] - Segundos até poder tentar novamente (rate limit).
 */
export interface AIProxyResponse<T = unknown> {
  result?: T;
  error?: string;
  consentType?: string;
  retryAfter?: number;
}

/**
 * Chama o Edge Function ai-proxy para executar uma ação de IA.
 * 
 * @template T Tipo do resultado esperado.
 * @param action - Ação de IA a ser executada.
 * @param data - Dados específicos da ação.
 * @returns Promise com o resultado da IA.
 * @throws Error se consentimento for necessário (com propriedade consentType).
 * @throws Error se rate limit for atingido (com propriedade retryAfter).
 * @throws Error para outros erros de processamento.
 * 
 * @example
 * ```typescript
 * const analysis = await callAIProxy<{ suggestion: string }>('analyzeLead', {
 *   deal: { title: 'Deal X', value: 1000 }
 * });
 * console.log(analysis.suggestion);
 * ```
 */
export async function callAIProxy<T = unknown>(
  action: AIAction,
  data: Record<string, unknown>
): Promise<T> {
  const res = await fetch('/api/ai/actions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ action, data }),
  });

  if (!res.ok) {
    // Prefer JSON error if available.
    const errorPayload = await res.json().catch(() => null);
    const msg = errorPayload?.error || `AI request failed: ${res.status}`;
    throw new Error(msg);
  }

  const response = (await res.json().catch(() => null)) as AIProxyResponse<T> | null;
  if (!response) throw new Error('Empty response from AI proxy');

  // Handle consent required
  if (response.error === 'AI consent required' && response.consentType) {
    const err = new Error(response.error) as Error & { consentType: string };
    err.consentType = response.consentType;
    throw err;
  }

  // Handle rate limiting
  if (response.error === 'Rate limit exceeded' && response.retryAfter) {
    const err = new Error(`Rate limit exceeded. Retry in ${response.retryAfter} seconds.`) as Error & { retryAfter: number };
    err.retryAfter = response.retryAfter;
    throw err;
  }

  // Handle other errors
  if (response.error) {
    throw new Error(response.error);
  }

  return response.result as T;
}

/**
 * Verifica se um erro é de consentimento necessário.
 * 
 * @param error - Erro a ser verificado.
 * @returns true se for erro de consentimento.
 * 
 * @example
 * ```typescript
 * if (isConsentError(error)) {
 *   openConsentModal(error.consentType);
 * }
 * ```
 */
export function isConsentError(error: unknown): error is Error & { consentType: string } {
  return error instanceof Error && 'consentType' in error;
}

/**
 * Verifica se um erro é de rate limit.
 * 
 * @param error - Erro a ser verificado.
 * @returns true se for erro de rate limit.
 * 
 * @example
 * ```typescript
 * if (isRateLimitError(error)) {
 *   showToast(`Tente novamente em ${error.retryAfter} segundos`);
 * }
 * ```
 */
export function isRateLimitError(error: unknown): error is Error & { retryAfter: number } {
  return error instanceof Error && 'retryAfter' in error;
}

/**
 * Reservation Tools for the WhatsApp AI Agent
 *
 * Provides functions to check availability, create reservations,
 * and look up existing bookings. Called by the AI agent during
 * message processing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createReservationClient } from '@/lib/reservations/client';

export interface ReservationAction {
  type: 'check_availability' | 'create_reservation' | 'lookup_reservation' | 'cancel_reservation';
  params: Record<string, unknown>;
}

/**
 * Detect if the customer message is about reservations and extract action parameters.
 */
export async function detectReservationIntent(
  supabase: SupabaseClient,
  organizationId: string,
  customerMessage: string,
  conversationHistory: string,
): Promise<{
  isReservationRelated: boolean;
  action?: ReservationAction;
  availabilityContext?: string;
}> {
  // Check if message mentions reservation-related keywords
  const reservationKeywords = [
    'reserv', 'agendar', 'agenda', 'marcar', 'horario', 'horário',
    'disponivel', 'disponível', 'vaga', 'mesa', 'lugar',
    'cancelar', 'desmarcar', 'codigo', 'código', 'confirmação',
    'confirmar', 'quantas pessoas', 'pax', 'booking',
  ];

  const lowerMsg = customerMessage.toLowerCase();
  const isReservationRelated = reservationKeywords.some(kw => lowerMsg.includes(kw));

  if (!isReservationRelated) {
    return { isReservationRelated: false };
  }

  // Get reservation client
  const client = await createReservationClient(supabase, organizationId);
  if (!client) {
    return { isReservationRelated: true };
  }

  // Build fresh availability context
  const availabilityContext = await client.buildAvailabilitySummary();

  // Detect specific action
  const action = detectSpecificAction(lowerMsg, conversationHistory);

  return {
    isReservationRelated: true,
    action,
    availabilityContext,
  };
}

function detectSpecificAction(message: string, _history: string): ReservationAction | undefined {
  // Cancel/lookup patterns
  if (message.match(/cancel|desmarc/i)) {
    return { type: 'cancel_reservation', params: {} };
  }

  if (message.match(/codigo|código|confirmação|confirma[çc]/i)) {
    // Extract confirmation code (usually uppercase letters/numbers)
    const codeMatch = message.match(/\b([A-Z0-9]{4,8})\b/);
    if (codeMatch) {
      return { type: 'lookup_reservation', params: { code: codeMatch[1] } };
    }
    return { type: 'lookup_reservation', params: {} };
  }

  // Check availability patterns
  if (message.match(/disponivel|disponível|tem vaga|horario|horário|quando|que dia/i)) {
    return { type: 'check_availability', params: {} };
  }

  // Create reservation patterns
  if (message.match(/reserv|agendar|marcar|quero|gostaria|pode marca/i)) {
    return { type: 'create_reservation', params: {} };
  }

  return undefined;
}

/**
 * Execute a reservation action and return context for the AI response.
 */
export async function executeReservationAction(
  supabase: SupabaseClient,
  organizationId: string,
  action: ReservationAction,
  params: {
    name?: string;
    phone?: string;
    date?: string;
    time?: string;
    pax?: number;
    code?: string;
  },
): Promise<{
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}> {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) {
    return { success: false, message: 'Sistema de reservas nao configurado.' };
  }

  try {
    switch (action.type) {
      case 'check_availability': {
        const summary = await client.buildAvailabilitySummary();
        return { success: true, message: summary };
      }

      case 'create_reservation': {
        if (!params.name || !params.phone || !params.date || !params.time || !params.pax) {
          const missing: string[] = [];
          if (!params.name) missing.push('nome');
          if (!params.phone) missing.push('telefone');
          if (!params.date) missing.push('data');
          if (!params.time) missing.push('horario');
          if (!params.pax) missing.push('numero de pessoas');
          return {
            success: false,
            message: `Informacoes faltando para a reserva: ${missing.join(', ')}`,
          };
        }

        // Get first active unit
        const units = await client.getUnits();
        if (units.length === 0) {
          return { success: false, message: 'Nenhuma unidade disponivel.' };
        }

        // Check availability for the requested date/time
        const availability = await client.getAvailability(units[0].id, params.date);
        const requestedSlot = availability.slots.find(s => s.time === params.time);

        if (!requestedSlot || requestedSlot.availablePax < (params.pax || 1)) {
          return {
            success: false,
            message: `Sem disponibilidade para ${params.pax} pessoas no horario ${params.time} do dia ${params.date}. Horarios disponiveis: ${availability.slots.filter(s => s.availablePax > 0).map(s => `${s.time} (${s.availablePax} vagas)`).join(', ')}`,
          };
        }

        const reservation = await client.createReservation({
          unitId: units[0].id,
          date: params.date,
          time: params.time,
          pax: params.pax,
          name: params.name,
          phone: params.phone,
        });

        return {
          success: true,
          message: `Reserva confirmada! Codigo: ${reservation.confirmation_code}`,
          data: {
            confirmation_code: reservation.confirmation_code,
            date: params.date,
            time: params.time,
            pax: params.pax,
          },
        };
      }

      case 'lookup_reservation': {
        const code = params.code || (action.params.code as string);
        if (!code) {
          return { success: false, message: 'Informe o codigo da reserva.' };
        }

        const reservation = await client.getByCode(code);
        if (!reservation) {
          return { success: false, message: `Nenhuma reserva encontrada com o codigo ${code}.` };
        }

        const customerData = reservation.customers as { name?: string } | undefined;
        const unitData = reservation.units as { name?: string } | undefined;
        return {
          success: true,
          message: `Reserva #${code}: ${customerData?.name || 'Cliente'} - ${reservation.reservation_date} as ${reservation.reservation_time} - ${reservation.pax} pessoas - ${unitData?.name || ''} - Status: ${reservation.status}`,
          data: reservation as unknown as Record<string, unknown>,
        };
      }

      case 'cancel_reservation': {
        // We don't cancel directly - inform the user to use the link
        return {
          success: true,
          message: 'Para cancelar sua reserva, acesse: https://fullhouseagendamento.vercel.app/minha-reserva e informe seu codigo de confirmacao.',
        };
      }

      default:
        return { success: false, message: 'Acao nao reconhecida.' };
    }
  } catch (err) {
    console.error('[reservation-tools] Error:', err);
    return { success: false, message: 'Erro ao processar sua solicitacao de reserva.' };
  }
}

/**
 * Build enhanced reservation instructions for the AI system prompt.
 * Includes real-time availability data.
 */
export async function buildReservationSystemPrompt(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) return '';

  try {
    const availability = await client.buildAvailabilitySummary();

    return `
${availability}

INSTRUCOES DE RESERVA (IMPORTANTE - SIGA EXATAMENTE):
1. Para CONSULTAR disponibilidade: mostre os horarios e vagas disponiveis da informacao acima
2. Para CRIAR reserva: colete TODAS as informacoes necessarias antes de confirmar:
   - Nome completo
   - Telefone (pode usar o da conversa)
   - Data desejada (formato YYYY-MM-DD)
   - Horario desejado (formato HH:MM)
   - Numero de pessoas
3. Antes de confirmar, verifique se o horario e data solicitados TEM VAGAS
4. Se nao houver vaga, sugira horarios alternativos
5. Sempre informe o link para reserva online: https://fullhouseagendamento.vercel.app
6. Se o cliente mencionar um codigo de confirmacao, busque os detalhes da reserva
7. Para cancelamento, direcione para: https://fullhouseagendamento.vercel.app/minha-reserva
8. Use o telefone da conversa WhatsApp como telefone da reserva (a menos que o cliente informe outro)
9. NUNCA invente horarios ou disponibilidade - use APENAS os dados acima

FORMATO DE CONFIRMACAO:
Quando tiver todas as informacoes, confirme com o cliente:
"Vou confirmar sua reserva:
Data: [data]
Horario: [horario]
Pessoas: [numero]
Nome: [nome]
Posso confirmar?"`;
  } catch (err) {
    console.error('[reservation-tools] Failed to build prompt:', err);
    return '';
  }
}

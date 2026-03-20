import { jsonSchema } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createReservationClient } from '@/lib/reservations/client';

/**
 * Retorna os Tools para Agendamentos no formato que generateText() realmente lê.
 *
 * BUG NO AI SDK v6: tool() armazena o schema em "parameters", mas generateText()
 * lê "inputSchema". Resultado: o schema chega vazio ao OpenAI → type: "None".
 *
 * FIX: Construímos os tools manualmente com "inputSchema" + "execute".
 * Quando o AI SDK corrigir isso, podemos voltar a usar tool().
 */
export async function buildReservationTools(
  supabase: SupabaseClient,
  organizationId: string,
  customerInfo: { phone: string; name: string }
) {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) return {};

  return {
    check_availability: {
      type: 'function' as const,
      description: 'Consulta a disponibilidade exata de horários, vagas e lotações de uma unidade de reserva para uma data específica.',
      inputSchema: jsonSchema<{ date: string }>({
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Data da reserva solicitada no formato YYYY-MM-DD' },
        },
        required: ['date'],
      }),
      execute: async ({ date }: { date: string }) => {
        try {
          const units = await client.getUnits();
          if (units.length === 0) return { available: false, message: 'Nenhuma unidade configurada' };

          const targetUnit = units[0];
          const availability = await client.getAvailability(targetUnit.id, date);

          const availableSlots = availability.slots.filter(s => s.availablePax > 0);

          if (availableSlots.length === 0) {
            return {
              available: false,
              message: `A unidade ${targetUnit.name} está LOTADA ou FECHADA nesta data (${date}). Ofereça outra data.`,
            };
          }

          return {
            available: true,
            unit_id: targetUnit.id,
            date,
            message: `Unidade ${targetUnit.name} aberta nesse dia. Mostre esses horários e vagas pro cliente:`,
            available_time_slots: availableSlots.map(s => ({
              time: s.time,
              available_pax_capacity: s.availablePax
            })),
          };
        } catch (e: unknown) {
          return { error: 'Falha ao consultar disponibilidade: ' + (e instanceof Error ? e.message : String(e)) };
        }
      },
    },

    create_reservation: {
      type: 'function' as const,
      description: 'Agenda e finaliza uma reserva em nome do cliente. Certifique-se ANTES (chamando check_availability) de que o horário tem vagas (pax) o suficiente para o número pedido de pessoas.',
      inputSchema: jsonSchema<{ unit_id: string; date: string; time: string; pax: number }>({
        type: 'object',
        properties: {
          unit_id: { type: 'string', description: 'ID da unidade em UUID retornado pelo check_availability' },
          date: { type: 'string', description: 'Data da reserva no formato YYYY-MM-DD' },
          time: { type: 'string', description: 'Horário exato da reserva no formato HH:MM (ex: 18:00)' },
          pax: { type: 'number', description: 'Quantidade total de pessoas na mesa (pax)' },
        },
        required: ['unit_id', 'date', 'time', 'pax'],
      }),
      execute: async ({ unit_id, date, time, pax }: { unit_id: string; date: string; time: string; pax: number }) => {
        try {
          const availability = await client.getAvailability(unit_id, date);
          const requestedSlot = availability.slots.find(s => s.time.startsWith(time));

          if (!requestedSlot || requestedSlot.availablePax < pax) {
             return { error: `Capacidade indisponível. Temos apenas ${requestedSlot?.availablePax || 0} vagas nesse horário.` };
          }

          const reservation = await client.createReservation({
            unitId: unit_id,
            date,
            time: requestedSlot.time,
            pax,
            name: customerInfo.name || 'Cliente WhatsApp',
            phone: customerInfo.phone,
          });

          return {
            success: true,
            message: 'A reserva foi efetuada e gravada com sucesso no sistema!',
            confirmation_code: reservation.confirmation_code,
          };
        } catch (e: unknown) {
          return { error: 'Falha durante o insert da reserva: ' + (e instanceof Error ? e.message : String(e)) };
        }
      },
    },

    lookup_reservation: {
      type: 'function' as const,
      description: 'Busca os detalhes de uma reserva pelo código de confirmação alphanumérico.',
      inputSchema: jsonSchema<{ code: string }>({
        type: 'object',
        properties: {
          code: { type: 'string', description: 'O código de confirmação da reserva. Ex: FH-A1B2C' },
        },
        required: ['code'],
      }),
      execute: async ({ code }: { code: string }) => {
        try {
          const reservation = await client.getByCode(code);
          if (!reservation) return { found: false, message: 'Reserva não encontrada.' };

          return {
            found: true,
            status: reservation.status,
            date: reservation.reservation_date,
            time: reservation.reservation_time,
            pax: reservation.pax,
            linked_customer_id: reservation.customer_id
          };
        } catch (e: unknown) {
          return { error: 'Falha ao processar código: ' + (e instanceof Error ? e.message : String(e)) };
        }
      }
    },
  };
}

/**
 * Build the system prompt rules to prime the AI for Tool Calling mechanics.
 */
export async function buildReservationSystemPrompt(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) return '';

  return `
REGRAS E CAPACIDADES DO AGENDAMENTO NATIVO (GOL DE BICICLETA):
1. Você tem total acesso ao sistema de reservas! Utilize a ferramenta (Tool Call) 'check_availability' SEMPRE que o usuário demonstrar interesse em um dia e quiser ver horários.
2. NUNCA invente horários! Leia exatamente o que a 'check_availability' te retornar de resposta.
3. Se o usuário confirmar quantas pessoas são e qual horário querem, você TEM PERMISSÃO para chamar a ferramenta 'create_reservation'.
4. Confirmação: Informe ao usuário do SUCESSO e mande o Código Alphanumérico de Confirmação que a Tool retornar para ele! Se der erro, informe sem tecnicalidades.
5. Se o usuário quiser cancelar, peça para ele acessar o portal online (https://fullhouseagendamento.vercel.app/minha-reserva). Você APENAS faz a reserva via Banco de Dados (Tool), sem desmarcar.
`;
}

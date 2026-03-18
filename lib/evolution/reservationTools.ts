import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createReservationClient } from '@/lib/reservations/client';

/**
 * Retorna os Tools oficiais (Vercel AI SDK Core) para Agendamentos
 */
export async function buildReservationTools(
  supabase: SupabaseClient,
  organizationId: string,
  customerInfo: { phone: string; name: string }
) {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) return {};

  return {
    check_availability: tool({
      description: 'Consulta a disponibilidade exata de horários, vagas e lotações de uma unidade de reserva para uma data específica.',
      parameters: z.object({
        date: z.string().describe('Data da reserva solicitada no formato YYYY-MM-DD'),
      }),
      execute: async ({ date }: { date: string }): Promise<any> => {
        try {
          const units = await client.getUnits();
          if (units.length === 0) return { available: false, message: 'Nenhuma unidade configurada' };

          // We assume single-unit for this example to simplify the prompt interaction (or the first available unit)
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
        } catch (e: any) {
          return { error: 'Falha ao consultar disponibilidade de banco de dados: ' + e.message };
        }
      },
    } as any),

    create_reservation: tool({
      description: 'Agenda e finaliza uma reserva em nome do cliente. Certifique-se ANTES (chamando check_availability) de que o horário tem vagas (pax) o suficiente para o número pedido de pessoas.',
      parameters: z.object({
        unit_id: z.string().describe('ID da unidade em UUID retornado pelo check_availability'),
        date: z.string().describe('Data da reserva no formato YYYY-MM-DD'),
        time: z.string().describe('Horário exato da reserva no formato HH:MM (ex: 18:00)'),
        pax: z.number().describe('Quantidade total de pessoas na mesa (pax)'),
      }),
      execute: async ({ unit_id, date, time, pax }: { unit_id: string; date: string; time: string; pax: number }): Promise<any> => {
        try {
          // Check for capacity safely
          const availability = await client.getAvailability(unit_id, date);
          const requestedSlot = availability.slots.find(s => s.time.startsWith(time));
          
          if (!requestedSlot || requestedSlot.availablePax < pax) {
             return { error: `Capacidade indisponível. Temos apenas ${requestedSlot?.availablePax || 0} vagas nesse horário.` };
          }

          const reservation = await client.createReservation({
            unitId: unit_id,
            date,
            time: requestedSlot.time, // Enforce normalized DD:MM:SS
            pax,
            name: customerInfo.name || 'Cliente WhatsApp',
            phone: customerInfo.phone,
          });

          return {
            success: true,
            message: 'A reserva foi efetuada e gravada com sucesso no sistema!',
            confirmation_code: reservation.confirmation_code,
          };
        } catch (e: any) {
          return { error: 'Falha durante o insert da reserva: ' + e.message };
        }
      },
    } as any),

    lookup_reservation: tool({
      description: 'Busca os detalhes de uma reserva pelo código de confirmação alphanumérico.',
      parameters: z.object({
         code: z.string().describe('O código de confirmação da reserva. Ex: FH-A1B2C'),
      }),
      execute: async ({ code }: { code: string }): Promise<any> => {
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
        } catch (e: any) {
          return { error: 'Falha ao processar código: ' + e.message };
        }
      }
    } as any),
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

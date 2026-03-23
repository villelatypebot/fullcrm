import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createReservationClient } from '@/lib/reservations/client';

// Build tools as plain objects with Zod parameters - compatible with generateText()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any;

/**
 * Build AI SDK tools for the reservation system.
 *
 * Uses Zod schemas (recommended by Vercel AI SDK) instead of jsonSchema()
 * to ensure compatibility with all providers (Google Gemini, OpenAI, Anthropic).
 */
export async function buildReservationTools(
  supabase: SupabaseClient,
  organizationId: string,
  customerInfo: { phone: string; name: string }
): Promise<Record<string, AnyTool>> {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) return {};

  // Pre-fetch units for tool descriptions
  let unitsList: Array<{ id: string; name: string; slug: string }> = [];
  try {
    unitsList = (await client.getUnits()).map(u => ({ id: u.id, name: u.name, slug: u.slug }));
  } catch { /* ignore */ }

  const unitsDescription = unitsList.length > 0
    ? `Unidades disponíveis: ${unitsList.map(u => `${u.name} (slug: ${u.slug})`).join(', ')}`
    : 'Consulte as unidades disponíveis';

  return {
    check_availability: {
      description: `Consulta a disponibilidade de horários e vagas de uma unidade para uma data. ${unitsDescription}. SEMPRE use esta ferramenta quando o cliente perguntar sobre disponibilidade, vagas, horários ou quiser fazer reserva.`,
      parameters: z.object({
        date: z.string().describe('Data da reserva no formato YYYY-MM-DD'),
        unit_name: z.string().describe('Nome ou slug da unidade (ex: "boa vista", "colubande", "araruama", "niteroi", "santa rosa")'),
      }),
      execute: async ({ date, unit_name }: { date: string; unit_name: string }) => {
        try {
          const unit = await client.findUnitByName(unit_name);
          if (!unit) {
            return {
              available: false,
              message: `Unidade "${unit_name}" não encontrada. Unidades disponíveis: ${unitsList.map(u => u.name).join(', ')}`,
              units_available: unitsList.map(u => u.name),
            };
          }

          const availability = await client.getAvailability(unit.id, date);
          const availableSlots = availability.slots.filter(s => s.availablePax > 0);

          if (availableSlots.length === 0) {
            return {
              available: false,
              unit_name: unit.name,
              date,
              message: `A unidade ${unit.name} está LOTADA ou FECHADA nesta data (${date}). Sugira outra data ou unidade ao cliente.`,
              other_units: unitsList.filter(u => u.id !== unit.id).map(u => u.name),
            };
          }

          return {
            available: true,
            unit_name: unit.name,
            date,
            message: `Unidade ${unit.name} tem disponibilidade em ${date}. Informe os horários ao cliente e SEMPRE inclua o link de reserva.`,
            available_time_slots: availableSlots.map(s => ({
              time: s.time,
              available_pax_capacity: s.availablePax,
            })),
            booking_link: 'https://fullhouseagendamento.vercel.app',
          };
        } catch (e: unknown) {
          return { error: 'Falha ao consultar disponibilidade: ' + (e instanceof Error ? e.message : String(e)) };
        }
      },
    },

    lookup_customer_reservations: {
      description: 'Busca reservas futuras do cliente atual pelo telefone. Use para verificar se o cliente já tem reserva antes de oferecer nova.',
      parameters: z.object({}),
      execute: async () => {
        try {
          const reservations = await client.getReservationsByPhone(customerInfo.phone);

          if (reservations.length === 0) {
            return {
              has_reservations: false,
              message: 'Cliente não possui reservas futuras.',
            };
          }

          return {
            has_reservations: true,
            count: reservations.length,
            reservations: reservations.map(r => ({
              date: r.reservation_date,
              time: r.reservation_time,
              pax: r.pax,
              status: r.status,
              unit_name: r.units?.name,
              confirmation_code: r.confirmation_code,
            })),
          };
        } catch (e: unknown) {
          return { error: 'Falha ao buscar reservas do cliente: ' + (e instanceof Error ? e.message : String(e)) };
        }
      },
    },
  };
}

/**
 * Build the system prompt section that teaches the AI how to handle reservations.
 * The AI should ALWAYS direct customers to the booking link.
 */
export async function buildReservationSystemPrompt(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const client = await createReservationClient(supabase, organizationId);
  if (!client) return '';

  let unitsText = '';
  try {
    const units = await client.getUnits();
    unitsText = units.map(u => `- ${u.name} (slug: ${u.slug})`).join('\n');
  } catch { /* ignore */ }

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 SISTEMA DE RESERVAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Você TEM ACESSO ao sistema de reservas via ferramentas (tool calls).

UNIDADES CADASTRADAS:
${unitsText || '(consultar via check_availability)'}

FLUXO OBRIGATÓRIO PARA RESERVAS:
1. Cliente pergunta sobre disponibilidade/vagas/horários → chame 'check_availability' com a data e unidade
2. Mostre os horários disponíveis retornados pela ferramenta (NUNCA invente horários)
3. SEMPRE direcione o cliente para fazer a reserva pelo link: https://fullhouseagendamento.vercel.app
4. Use 'lookup_customer_reservations' para verificar se o cliente JÁ TEM reserva antes de oferecer nova

REGRAS CRÍTICAS DE RESERVA:
- NUNCA colete dados de reserva pelo WhatsApp (nome, data, horário, etc). A reserva é feita SOMENTE pelo link.
- SEMPRE que o assunto for reserva, use 'check_availability' para consultar disponibilidade real.
- Após mostrar os horários disponíveis, SEMPRE envie o link: https://fullhouseagendamento.vercel.app
- NUNCA transfira para atendente humano quando o assunto for reserva. Você TEM as ferramentas para consultar.
- Se der erro na ferramenta, envie o link como alternativa: https://fullhouseagendamento.vercel.app
- Para cancelamento/alteração, oriente: https://fullhouseagendamento.vercel.app/minha-reserva
- NUNCA peça os dados para "fazer a reserva por aqui". A reserva é feita EXCLUSIVAMENTE pelo link.
`;
}

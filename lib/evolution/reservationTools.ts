import { jsonSchema } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createReservationClient } from '@/lib/reservations/client';

/**
 * Build AI SDK tools for the reservation system.
 *
 * Tools available:
 * 1. check_availability - Check available time slots for a unit + date
 * 2. create_reservation - Book a reservation
 * 3. lookup_reservation - Find reservation by confirmation code
 * 4. lookup_customer_reservations - Find reservations by phone number
 */
export async function buildReservationTools(
  supabase: SupabaseClient,
  organizationId: string,
  customerInfo: { phone: string; name: string }
) {
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
      type: 'function' as const,
      description: `Consulta a disponibilidade de horários e vagas de uma unidade para uma data. ${unitsDescription}. SEMPRE use esta ferramenta quando o cliente perguntar sobre disponibilidade, vagas, horários ou quiser reservar.`,
      inputSchema: jsonSchema<{ date: string; unit_name: string }>({
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Data da reserva no formato YYYY-MM-DD' },
          unit_name: { type: 'string', description: 'Nome ou slug da unidade (ex: "boa vista", "colubande", "araruama", "niteroi")' },
        },
        required: ['date', 'unit_name'],
      }),
      execute: async ({ date, unit_name }: { date: string; unit_name: string }) => {
        try {
          // Find unit by name
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
            unit_id: unit.id,
            unit_name: unit.name,
            date,
            message: `Unidade ${unit.name} tem disponibilidade em ${date}. Informe os horários ao cliente e pergunte qual prefere:`,
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

    create_reservation: {
      type: 'function' as const,
      description: 'Cria uma reserva para o cliente. Use APENAS após confirmar com o cliente: unidade, data, horário e número de pessoas. Chame check_availability ANTES para garantir que há vagas.',
      inputSchema: jsonSchema<{ unit_id: string; date: string; time: string; pax: number }>({
        type: 'object',
        properties: {
          unit_id: { type: 'string', description: 'ID da unidade (UUID retornado por check_availability)' },
          date: { type: 'string', description: 'Data da reserva no formato YYYY-MM-DD' },
          time: { type: 'string', description: 'Horário da reserva no formato HH:MM (ex: 18:00)' },
          pax: { type: 'number', description: 'Quantidade total de pessoas' },
        },
        required: ['unit_id', 'date', 'time', 'pax'],
      }),
      execute: async ({ unit_id, date, time, pax }: { unit_id: string; date: string; time: string; pax: number }) => {
        try {
          const availability = await client.getAvailability(unit_id, date);
          const requestedSlot = availability.slots.find(s => s.time.startsWith(time));

          if (!requestedSlot || requestedSlot.availablePax < pax) {
            return {
              error: `Capacidade insuficiente. Temos apenas ${requestedSlot?.availablePax || 0} vagas nesse horário. Sugira outro horário.`,
            };
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
            message: 'Reserva criada com sucesso! Informe o código de confirmação ao cliente.',
            confirmation_code: reservation.confirmation_code,
            unit_name: availability.unitName,
            date,
            time,
            pax,
          };
        } catch (e: unknown) {
          return { error: 'Falha ao criar reserva: ' + (e instanceof Error ? e.message : String(e)) };
        }
      },
    },

    lookup_reservation: {
      type: 'function' as const,
      description: 'Busca uma reserva pelo código de confirmação.',
      inputSchema: jsonSchema<{ code: string }>({
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Código de confirmação (ex: FH-A1B2C)' },
        },
        required: ['code'],
      }),
      execute: async ({ code }: { code: string }) => {
        try {
          const reservation = await client.getByCode(code);
          if (!reservation) return { found: false, message: 'Reserva não encontrada com esse código.' };

          return {
            found: true,
            status: reservation.status,
            date: reservation.reservation_date,
            time: reservation.reservation_time,
            pax: reservation.pax,
            unit_name: reservation.units?.name,
            confirmation_code: reservation.confirmation_code,
          };
        } catch (e: unknown) {
          return { error: 'Falha ao buscar reserva: ' + (e instanceof Error ? e.message : String(e)) };
        }
      },
    },

    lookup_customer_reservations: {
      type: 'function' as const,
      description: 'Busca reservas futuras do cliente atual pelo telefone. Use para verificar se o cliente já tem reserva antes de oferecer nova.',
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        properties: {},
      }),
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
 * Build the system prompt section that teaches the AI how to use reservation tools.
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
📅 SISTEMA DE RESERVAS (FERRAMENTAS DISPONÍVEIS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Você TEM ACESSO DIRETO ao sistema de reservas via ferramentas (Tool Calls). USE SEMPRE:

UNIDADES CADASTRADAS:
${unitsText || '(consultar via check_availability)'}

FLUXO OBRIGATÓRIO:
1. Cliente pergunta sobre disponibilidade/vagas/horários → chame 'check_availability' com a data e unidade
2. Mostre os horários e vagas retornados (NUNCA invente horários)
3. Cliente confirma horário e pessoas → chame 'create_reservation'
4. Informe o código de confirmação ao cliente
5. Sempre informe também o link: https://fullhouseagendamento.vercel.app

REGRAS IMPORTANTES:
- SEMPRE use 'check_availability' quando o cliente perguntar sobre vagas/datas/horários. NUNCA responda de cabeça.
- Se o cliente mencionar uma unidade, use o nome dela. Se não mencionar, pergunte qual unidade.
- Use 'lookup_customer_reservations' para verificar se o cliente JÁ TEM reserva antes de oferecer nova.
- NUNCA transfira para atendente quando o assunto for reserva. Você TEM as ferramentas para resolver.
- Se der erro na ferramenta, informe de forma amigável e sugira o link online como alternativa.
- Para cancelamento/alteração, oriente o cliente a acessar: https://fullhouseagendamento.vercel.app/minha-reserva
`;
}

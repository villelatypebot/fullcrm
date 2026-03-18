# FullHouse CRM - Documentacao Completa

## Visao Geral

CRM completo com agente de IA no WhatsApp, sistema de reservas integrado e pipeline de vendas. Construido com Next.js 16, Supabase, TanStack Query e Evolution API.

- **URL Producao**: https://fullcrm-five.vercel.app
- **Supabase CRM**: https://yldnqpxtzoglqfosykhd.supabase.co
- **Supabase Agendamentos**: https://bqroijjherbnhsdsnaor.supabase.co
- **App Agendamentos**: https://fullhouseagendamento.vercel.app

---

## 1. Stack Tecnologico

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4 |
| Estado | TanStack Query 5, Zustand, React Context |
| UI | Radix UI, Lucide Icons, Framer Motion |
| Backend | Next.js API Routes, Vercel Serverless |
| Banco | Supabase (PostgreSQL + Auth + Realtime + RLS) |
| WhatsApp | Evolution API v2 |
| IA | Vercel AI SDK, Google Gemini, OpenAI GPT-4, Anthropic Claude |
| Cron | Vercel Cron Jobs (follow-ups a cada 1 min) |
| Deploy | Vercel (auto-deploy via GitHub) |

---

## 2. Estrutura de Pastas

```
fullcrm-main/
├── app/                          # Next.js App Router
│   ├── (protected)/              # Rotas autenticadas
│   │   ├── dashboard/            # Visao geral
│   │   ├── inbox/                # Inbox de mensagens
│   │   ├── boards/               # Kanban boards
│   │   ├── contacts/             # Gestao de contatos
│   │   ├── whatsapp/             # Integracao WhatsApp
│   │   ├── activities/           # Atividades
│   │   ├── reports/              # Relatorios
│   │   ├── settings/             # Configuracoes
│   │   ├── ai/                   # Hub de IA
│   │   ├── deals/[dealId]/       # Cockpit de negocio
│   │   └── decisions/            # Fila de decisoes IA
│   ├── api/                      # Rotas de API
│   ├── login/                    # Login
│   ├── join/                     # Convite de equipe
│   └── install/                  # Wizard de instalacao
├── features/                     # Modulos por feature
│   ├── contacts/                 # Contatos (lista, forms, badges)
│   ├── whatsapp/                 # WhatsApp (conversas, config IA)
│   ├── boards/                   # Boards (kanban, drag-drop)
│   ├── deals/                    # Negocios (cockpit)
│   ├── dashboard/                # Dashboard (charts, KPIs)
│   ├── inbox/                    # Inbox
│   ├── activities/               # Atividades
│   ├── reports/                  # Relatorios
│   ├── settings/                 # Configuracoes
│   ├── ai-hub/                   # Hub IA
│   ├── decisions/                # Decisoes IA
│   └── profile/                  # Perfil usuario
├── lib/                          # Bibliotecas compartilhadas
│   ├── evolution/                # Pipeline IA WhatsApp
│   │   ├── aiAgent.ts            # Orquestrador principal
│   │   ├── intelligence.ts       # Motor de inteligencia
│   │   ├── followUpProcessor.ts  # Processador de follow-ups
│   │   ├── reservationTools.ts   # Ferramentas de reserva
│   │   └── client.ts             # Cliente Evolution API
│   ├── reservations/             # Sistema de reservas
│   │   ├── client.ts             # Cliente Supabase Agendamentos
│   │   └── types.ts              # Tipos de reserva
│   ├── supabase/                 # Operacoes de banco
│   │   ├── whatsappIntelligence.ts  # Memorias, scores, labels, follow-ups
│   │   ├── whatsapp.ts           # Conversas, mensagens, config IA
│   │   ├── contacts.ts           # CRUD contatos + temperatura
│   │   ├── deals.ts              # Negocios
│   │   ├── boards.ts             # Boards e stages
│   │   └── activities.ts         # Atividades
│   ├── ai/                       # Agente IA do CRM
│   │   ├── crmAgent.ts           # Agente CRM (chat interno)
│   │   ├── tools.ts              # 50+ ferramentas IA
│   │   └── prompts/              # System prompts
│   └── query/                    # React Query hooks
├── types/                        # Definicoes de tipos
│   ├── types.ts                  # Tipos CRM (Contact, Deal, Board)
│   ├── whatsapp.ts               # Tipos WhatsApp (Conversation, Message, AIConfig)
│   └── ai.ts                     # Tipos IA
├── context/                      # React Context providers
└── components/                   # Componentes compartilhados
```

---

## 3. Navegacao Principal

```
Sidebar:
├── Inbox          → /inbox         (mensagens WhatsApp)
├── Visao Geral    → /dashboard     (analytics, KPIs)
├── Boards         → /boards        (kanban pipeline)
├── Contatos       → /contacts      (leads + temperatura)
├── WhatsApp       → /whatsapp      (conversas + config IA)
├── Atividades     → /activities    (historico)
├── Relatorios     → /reports       (exports, graficos)
└── Configuracoes  → /settings      (org, IA, integracoes)
```

---

## 4. Todas as Rotas de API

### 4.1 WhatsApp

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/whatsapp/webhook/[instanceId]` | POST | Webhook da Evolution API (mensagens, conexao) |
| `/api/whatsapp/conversations` | GET | Listar conversas |
| `/api/whatsapp/conversations/[id]/messages` | GET | Mensagens da conversa (paginado) |
| `/api/whatsapp/conversations/[id]/send` | POST | Enviar mensagem manual |
| `/api/whatsapp/conversations/[id]/intelligence` | GET | Dados de inteligencia (memorias, score, labels) |
| `/api/whatsapp/conversations/[id]/memory` | GET/DELETE | Memorias da conversa |
| `/api/whatsapp/conversations/[id]/labels` | GET/POST/DELETE | Labels da conversa |
| `/api/whatsapp/conversations/[id]/ai` | POST | Controlar IA (pausar/retomar) |
| `/api/whatsapp/labels` | GET/POST | Listar/criar labels |
| `/api/whatsapp/instances` | GET/POST | Listar/criar instancias |
| `/api/whatsapp/instances/[id]` | GET/PUT/DELETE | CRUD instancia |
| `/api/whatsapp/instances/[id]/ai-config` | GET/PUT | Config IA da instancia |
| `/api/whatsapp/instances/[id]/qrcode` | GET | QR Code para conectar |
| `/api/whatsapp/instances/[id]/configure-webhooks` | POST | Configurar webhooks |
| `/api/whatsapp/instances/[id]/sync-chats` | POST | Sincronizar chats existentes |
| `/api/whatsapp/follow-ups/process` | POST | Processar follow-ups (cron 1min) |

### 4.2 Webhooks

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/webhooks/reservations` | POST | Receber eventos de reserva (confirmed/cancelled/no_show) |

### 4.3 Contatos

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/contacts/sync-temperatures` | POST | Sync bulk de temperaturas lead_scores → contacts |
| `/api/contacts/export` | GET | Exportar CSV |
| `/api/contacts/import` | POST | Importar CSV |

### 4.4 Configuracoes

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/settings/ai` | GET/POST | Config provedor IA (chaves, modelos) |
| `/api/settings/evolution` | GET/POST | Config Evolution API |
| `/api/settings/ai-features` | GET | Feature flags IA |
| `/api/settings/ai-prompts` | GET/POST | Prompts IA |
| `/api/settings/ai-prompts/[key]` | GET/PATCH/DELETE | CRUD prompt |

### 4.5 IA (CRM Interno)

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/ai/chat` | POST | Chat IA streaming |
| `/api/ai/actions` | POST | Acoes IA (email, briefing, board) |
| `/api/ai/tasks/deals/analyze` | POST | Analisar negocio |
| `/api/ai/tasks/deals/email-draft` | POST | Rascunho de email |
| `/api/ai/tasks/deals/objection-responses` | POST | Respostas a objecoes |
| `/api/ai/tasks/boards/generate-structure` | POST | Gerar estrutura board |
| `/api/ai/tasks/boards/generate-strategy` | POST | Gerar estrategia |
| `/api/ai/tasks/boards/refine` | POST | Refinar board |
| `/api/ai/tasks/inbox/daily-briefing` | POST | Briefing diario |
| `/api/ai/tasks/inbox/sales-script` | POST | Script de vendas |

### 4.6 API Publica v1 (Requer API Key)

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/public/v1/me` | GET | Info do usuario/org |
| `/api/public/v1/contacts` | GET/POST | Listar/criar contatos |
| `/api/public/v1/contacts/[id]` | GET/PATCH | Detalhe/atualizar contato |
| `/api/public/v1/deals` | GET/POST | Listar/criar negocios |
| `/api/public/v1/deals/[id]` | GET/PATCH | Detalhe/atualizar negocio |
| `/api/public/v1/deals/move-stage` | POST | Mover negocio de estagio |
| `/api/public/v1/deals/[id]/mark-won` | POST | Marcar como ganho |
| `/api/public/v1/deals/[id]/mark-lost` | POST | Marcar como perdido |
| `/api/public/v1/deals/move-stage-by-identity` | POST | Mover por telefone/email |
| `/api/public/v1/companies` | GET/POST | Listar/criar empresas |
| `/api/public/v1/companies/[id]` | GET/PATCH | Detalhe/atualizar empresa |
| `/api/public/v1/boards` | GET | Listar boards |
| `/api/public/v1/boards/[id]/stages` | GET | Stages do board |
| `/api/public/v1/activities` | GET/POST | Listar/criar atividades |
| `/api/public/v1/reservations` | GET | Disponibilidade de reservas |
| `/api/public/v1/docs` | GET | Swagger UI |
| `/api/public/v1/openapi.json` | GET | Schema OpenAPI 3.0 |

### 4.7 Admin

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/admin/users` | GET/POST | Listar/criar usuarios |
| `/api/admin/users/[id]` | GET/DELETE | Detalhe/remover usuario |
| `/api/admin/invites` | GET/POST | Listar/criar convites |
| `/api/admin/invites/[id]` | DELETE | Remover convite |

### 4.8 Setup

| Rota | Metodo | Descricao |
|------|--------|-----------|
| `/api/setup-instance` | POST | Setup inicial (empresa, email, senha) |
| `/api/installer/*` | Varios | Wizard de instalacao (bootstrap, health, migrate) |

---

## 5. Pipeline do Agente IA WhatsApp

### 5.1 Fluxo Completo de Processamento

```
Mensagem chega via Evolution API
        │
        ▼
POST /api/whatsapp/webhook/{instanceId}
        │
        ├─ Extrai conteudo (texto/media/localizacao)
        ├─ Salva mensagem no banco
        ├─ Atualiza metadados da conversa
        │
        ▼
processIncomingMessage() [ASYNC]
        │
        ├─ Verifica: IA ativa? Horario comercial?
        ├─ Auto-cria contato no CRM (se configurado)
        │
        ▼
Motor de Inteligencia (analyzeMessage)
        │
        ├─ Deteccao LOCAL de intents (regex)
        │   • check_with_spouse → +5 score, follow-up 30min
        │   • think_about_it → 0 score, follow-up 1h
        │   • price_inquiry → +15 score
        │   • availability_check → +20 score
        │   • ready_to_buy → +30 score
        │   • not_interested → -30 score
        │   • wants_human → pausa inteligente
        │
        ├─ Analise por IA (se habilitada)
        │   Extrai: intents, memorias, sentimento,
        │   score_delta, buying_stage, labels,
        │   should_pause, follow_up_context
        │
        ▼
Acoes pos-analise
        │
        ├─ Salva memorias (familia, preferencias, orcamento...)
        ├─ Atualiza lead score + temperatura
        ├─ Atribui labels automaticas
        ├─ Agenda follow-ups (sequencia configuravel)
        │
        ▼
Verificacoes
        │
        ├─ Pausa inteligente? → Transfere pra humano, PARA
        ├─ Limite de mensagens? → Escala, PARA
        │
        ▼
Construcao de Contexto
        │
        ├─ Historico da conversa (ultimas 20 msgs)
        ├─ Dados CRM (contato + negocios)
        ├─ Memorias organizadas por tipo
        ├─ Contexto de reservas (disponibilidade real)
        │
        ▼
Geracao de Resposta IA
        │
        ├─ System prompt: persona + instrucoes + contexto
        ├─ Provedor: Google/OpenAI/Anthropic
        ├─ Max tokens: 500
        │
        ▼
Envio via Evolution API
        │
        ├─ Aplica delay simulado (reply_delay_ms)
        ├─ sendText() via Evolution API
        ├─ Salva mensagem (from_me: true, sent_by: 'ai_agent')
        ├─ Loga acao
        └─ Gera resumo (a cada 10 mensagens)
```

### 5.2 Tipos de Memoria Extraidos

| Tipo | Exemplo |
|------|---------|
| `family` | "Esposa se chama Maria, 2 filhos" |
| `preference` | "Prefere mesa perto da janela" |
| `budget` | "Orcamento ate R$3000" |
| `interest` | "Interessado no pacote premium" |
| `timeline` | "Quer reservar para proximo sabado" |
| `objection` | "Achou caro comparado ao concorrente" |
| `personal` | "Mora em Niteroi, 35 anos" |
| `interaction` | "Prefere mensagens curtas e diretas" |
| `fact` | "Ja foi cliente em 2024" |

### 5.3 Sistema de Lead Scoring

```
Score: 0-100
Temperatura:
  0-29  = cold (Frio)     ❄️
  30-59 = warm (Morno)    🌤️
  60-79 = hot (Quente)    🌡️
  80+   = on_fire (On Fire) 🔥

Deltas por intent:
  price_inquiry:      +15
  availability_check: +20
  ready_to_buy:       +30
  check_with_spouse:  +5
  think_about_it:     0
  budget_hold:        -10
  not_interested:     -30

Sincronizacao: whatsapp_lead_scores → contacts
(temperatura aparece na lista de contatos)
```

---

## 6. Sistema de Follow-ups

### 6.1 Sequencia Configuravel

Configurado na UI do Agente I.A. (WhatsApp > Agente I.A.):

```
Etapa 1: "Primeiro contato"  → 30 minutos
Etapa 2: "Segundo contato"   → 60 minutos (1h)
Etapa 3: "Terceiro contato"  → 180 minutos (3h)
Max follow-ups por conversa: 3
```

### 6.2 Fluxo de Encadeamento

```
1. Cliente envia "vou pensar" → Intent: think_about_it
2. IA cria follow-up: trigger_at = agora + 30min, sequence_index = 0
3. Cron (1min) detecta follow-up pendente
4. Verifica horario silencioso
5. Gera mensagem contextual usando memorias
6. Envia via Evolution API
7. Reativa IA na conversa
8. Cria proximo follow-up: trigger_at = agora + 60min, sequence_index = 1
9. Repete ate sequence_index >= total_steps OU cliente responde

Se cliente responde a qualquer momento:
→ cancelPendingFollowUps() cancela todos pendentes
→ IA processa normalmente a nova mensagem
```

### 6.3 Horario Silencioso

Se `follow_up_quiet_hours_start` e `follow_up_quiet_hours_end` configurados:
- Follow-ups dentro do periodo sao reagendados para 5min apos o fim
- Evita envio de mensagens de madrugada

---

## 7. Integracao com Sistema de Reservas (Agendamentos)

### 7.1 Arquitetura

```
┌──────────────────┐     ┌──────────────────────┐
│  FullHouse CRM   │     │  Agendamentos App    │
│  (fullcrm-main)  │     │  (fullhouse-reservas)│
│                  │     │                      │
│  Supabase:       │     │  Supabase:           │
│  yldnqpxtzoglq   │     │  bqroijjherbnhsds    │
│                  │     │                      │
│  Conecta via     │────▶│  Tabelas: units,     │
│  service_role_key│     │  time_slots,         │
│  (direto no DB)  │     │  reservations,       │
│                  │     │  customers           │
│                  │     │                      │
│  Webhook receiver│◀────│  Envia eventos:      │
│  /api/webhooks/  │     │  reservation.*       │
│  reservations    │     │                      │
└──────────────────┘     └──────────────────────┘
```

### 7.2 Credenciais de Conexao

Armazenadas em `organization_settings`:
- `reservation_supabase_url` → URL do Supabase Agendamentos
- `reservation_supabase_key` → service_role key do Agendamentos

### 7.3 Unidades Disponiveis

| Unidade | Slug |
|---------|------|
| Full House Boa Vista | boa-vista |
| Full House Colubande | colubande |
| Full House Araruama | araruama |
| Full House Niteroi | niteroi |

### 7.4 ReservationClient (lib/reservations/client.ts)

```typescript
class ReservationClient {
  getUnits()                          // Lista unidades ativas
  getAvailability(unitId, date)       // Vagas por horario
  createReservation({                 // Cria reserva
    unitId, date, time, pax,
    name, phone, email
  })
  getByCode(code)                     // Busca por codigo
  getReservationsForDate(unitId, date)// Reservas do dia
  buildAvailabilitySummary(unitId?)   // Resumo para IA
}
```

### 7.5 Deteccao de Intent de Reserva

Keywords detectados em `reservationTools.ts`:
- `reserv`, `agendar`, `marcar`, `horario`, `disponivel`, `vaga`
- `mesa`, `lugar`, `rodizio`

Acoes mapeadas:
| Keyword | Acao |
|---------|------|
| reservar, agendar, marcar | `create_reservation` |
| disponivel, horario, quando | `check_availability` |
| codigo, confirmacao | `lookup_reservation` |
| cancelar, desmarcar | `cancel_reservation` |

### 7.6 Fluxo de Reserva via WhatsApp

```
Cliente: "Tem vaga para 4 pessoas amanha?"
  → Intent: availability_check (+20 score)
  → buildReservationSystemPrompt() busca disponibilidade real
  → IA responde com horarios disponiveis

Cliente: "Quero 20:00, nome Joao, tel 11999999999"
  → Intent: ready_to_buy (+30 score)
  → executeReservationAction('create_reservation')
  → Valida dados + verifica vagas
  → ReservationClient.createReservation()
  → Retorna codigo de confirmacao
  → IA envia confirmacao com codigo

[Sistema de Agendamentos envia webhook]
  → POST /api/webhooks/reservations
  → event: reservation.confirmed
  → Busca/cria contato no CRM
  → Define temperatura = 'warm'
  → Cria atividade: "Reserva confirmada #ABC123"
```

### 7.7 Contexto de Disponibilidade no Prompt

Injetado automaticamente no system prompt da IA:
```
=== DISPONIBILIDADE DE RESERVAS ===
Full House Boa Vista - Hoje (Ter 18/03):
  19:00 (2 vagas), 20:00 (4 vagas), 21:00 (1 vaga)
Full House Boa Vista - Amanha (Qua 19/03):
  18:30 (5 vagas), 20:00 (3 vagas)
Full House Boa Vista - Qui 20/03: LOTADO

Link reserva online: https://fullhouseagendamento.vercel.app

INSTRUCOES: Mostre horarios disponiveis. Para criar reserva,
colete: nome, telefone, data, horario, numero de pessoas.
Nunca invente horarios ou disponibilidade.
```

---

## 8. Webhook do WhatsApp (Evolution API)

### 8.1 Endpoint

`POST /api/whatsapp/webhook/{instanceId}`

### 8.2 Eventos Processados

| Evento | Acao |
|--------|------|
| `messages.upsert` | Nova mensagem → salva, atualiza conversa, dispara IA |
| `messages.update` | Status (sent/received/read) → atualiza mensagem |
| `connection.update` | Conectado/desconectado → atualiza instancia |

### 8.3 Tipos de Mensagem Suportados

- Texto: `conversation`, `extendedTextMessage`
- Midia: image, video, audio, document, sticker
- Interativo: location, reaction, contact, list_response, button_response

---

## 9. Webhook de Reservas

### 9.1 Endpoint

`POST /api/webhooks/reservations`

### 9.2 Eventos

| Evento | Acao no CRM |
|--------|-------------|
| `reservation.confirmed` | Cria/atualiza contato (temp=warm), cria atividade |
| `reservation.cancelled` | Atualiza atividade |
| `reservation.no_show` | Loga no-show |
| `reservation.seated` | Confirma check-in |

---

## 10. Tabelas do Banco (Supabase CRM)

### 10.1 WhatsApp

| Tabela | Funcao |
|--------|--------|
| `whatsapp_instances` | Instancias Evolution API conectadas |
| `whatsapp_ai_config` | Configuracao IA por instancia (persona, horarios, features) |
| `whatsapp_conversations` | Conversas (phone, ai_active, unread_count) |
| `whatsapp_messages` | Mensagens (text, media, status, sent_by) |
| `whatsapp_chat_memory` | Memorias extraidas (tipo, chave, valor, confianca) |
| `whatsapp_lead_scores` | Scores (0-100, temperatura, historico) |
| `whatsapp_follow_ups` | Follow-ups (trigger_at, status, context, sequence_index) |
| `whatsapp_labels` | Labels (nome, cor, is_system) |
| `whatsapp_conversation_labels` | Labels por conversa (assigned_by: ai/human) |
| `whatsapp_conversation_summaries` | Resumos periodicos |
| `whatsapp_ai_logs` | Logs de acoes IA |

### 10.2 CRM Core

| Tabela | Funcao |
|--------|--------|
| `contacts` | Contatos (nome, tel, email, temperature, lead_score, buying_stage) |
| `crm_companies` | Empresas |
| `deals` | Negocios (valor, estagio, board) |
| `boards` | Kanban boards |
| `stages` | Estagios do pipeline |
| `activities` | Historico de atividades |
| `products` | Catalogo de produtos |

### 10.3 Organizacao

| Tabela | Funcao |
|--------|--------|
| `organization_settings` | Config da org (IA keys, Evolution URL, reservas) |
| `profiles` | Usuarios |
| `invites` | Convites de equipe |

---

## 11. Configuracao do Agente IA

Acessivel em: WhatsApp > Agente I.A.

### 11.1 Persona

| Campo | Descricao |
|-------|-----------|
| `agent_name` | Nome do agente (ex: "Eshylei") |
| `agent_role` | Papel (ex: "Assistente virtual") |
| `agent_tone` | Tom: professional, friendly, casual, formal |
| `system_prompt` | Instrucoes detalhadas |

### 11.2 Mensagens Automaticas

| Campo | Quando |
|-------|--------|
| `greeting_message` | Primeira mensagem do cliente |
| `transfer_message` | Transferencia para humano |
| `outside_hours_message` | Fora do horario comercial |

### 11.3 Horario Comercial

| Campo | Exemplo |
|-------|---------|
| `working_hours_start` | "09:00" |
| `working_hours_end` | "18:00" |
| `working_days` | [1,2,3,4,5] (seg-sex) |

### 11.4 Features Habilitaveis

| Feature | Funcao |
|---------|--------|
| `memory_enabled` | Extrai e armazena memorias |
| `lead_scoring_enabled` | Calcula lead score |
| `auto_label_enabled` | Atribui labels automaticamente |
| `follow_up_enabled` | Agenda follow-ups inteligentes |
| `smart_pause_enabled` | Detecta pedido de humano e pausa |
| `summary_enabled` | Gera resumos periodicos |
| `auto_create_contact` | Cria contato no CRM automaticamente |
| `auto_create_deal` | Cria negocio na primeira mensagem |

### 11.5 Sequencia de Follow-ups

Editavel na UI com ate 5 etapas:
```
Etapa 1: Label + Delay (minutos)
Etapa 2: Label + Delay (minutos)
...
Max follow-ups por conversa: N
```

---

## 12. Pausa Inteligente (Smart Pause)

### Quando ativa:
- Cliente pede humano: "quero falar com uma pessoa"
- Sentimento muito negativo
- IA detecta necessidade de transferencia

### O que acontece:
1. `ai_active = false` na conversa
2. Envia `transfer_message` configurada
3. Loga acao `smart_paused`
4. IA para de responder ate reativacao manual

---

## 13. Cron Jobs

| Job | Frequencia | Funcao |
|-----|-----------|--------|
| Follow-up Processor | 1 minuto | Processa follow-ups com trigger_at <= agora |

Endpoint: `POST /api/whatsapp/follow-ups/process`

Configurado em `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/whatsapp/follow-ups/process",
    "schedule": "* * * * *"
  }]
}
```

---

## 14. Provedores de IA Suportados

| Provedor | Modelos |
|----------|---------|
| Google | gemini-2.5-flash (padrao), gemini-2.5-pro |
| OpenAI | gpt-4.1, gpt-4o, gpt-4o-mini |
| Anthropic | claude-sonnet-4-5, claude-haiku-4-5 |

Configuravel em: Configuracoes > IA

---

## 15. Mudancas Recentes (Marco 2026)

### Commit: feat: follow-up timing fix, temperature sync, reservation integration
- Follow-ups usam sequencia configuravel (nao mais delay da IA)
- `cancelPendingFollowUps` antes de agendar novos
- Sync retroativo de temperatura em `autoCreateContact`
- `reservationTools.ts` com deteccao, execucao e prompt builder
- Endpoint publico `/api/public/v1/reservations`
- Webhook de reservas define temperatura 'warm'

### Commit: feat: temperature badges, follow-up sequence editor, cleanup
- Campos `temperature`, `lead_score`, `buying_stage` no tipo Contact e DbContact
- Badge de temperatura na lista de contatos (Frio/Morno/Quente/On Fire)
- Editor visual de sequencia de follow-ups (ate 5 etapas)
- Removidos 7 endpoints de debug/migracao

---

## 16. Variaveis de Ambiente Necessarias

```env
# Supabase CRM
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=

# Configuradas no banco (organization_settings):
# - evolution_api_url (URL da Evolution API)
# - evolution_api_key (Chave da Evolution API)
# - ai_openai_key / ai_google_key / ai_anthropic_key
# - reservation_supabase_url (URL do Supabase Agendamentos)
# - reservation_supabase_key (service_role key do Agendamentos)
```

---

## 17. Como Testar End-to-End

### Temperatura
1. Enviar mensagem no WhatsApp → IA responde
2. Verificar em Contatos se temperatura aparece com badge colorido
3. Score deve aumentar conforme intents detectados

### Follow-ups
1. Configurar sequencia: 5min / 10min / 15min (para teste)
2. Enviar "vou pensar" no WhatsApp
3. Verificar 3 follow-ups encadeados nos tempos configurados
4. Responder a qualquer momento → follow-ups pendentes cancelados

### Reservas
1. Perguntar "tem vaga para amanha?" no WhatsApp
2. IA responde com disponibilidade real das unidades
3. Criar reserva no sistema de Agendamentos
4. Verificar contato aparece no CRM com temperatura 'warm'
5. Atividade "Reserva confirmada #CODIGO" criada automaticamente

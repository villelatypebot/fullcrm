# Feature Specification: Web Mobile-Comparable + PWA

**Feature Branch**: `001-mobile-shell-pwa`  
**Created**: 2025-12-28  
**Status**: Draft  
**Input**: User description: "Transformar o NossoCRM web em experiência mobile/tablet comparável a app, sem app nativo: BottomNav no mobile, Navigation Rail no tablet, flows core em Sheets/Fullscreen Sheets, Boards mobile-first (list por estágio), e PWA instalável com prompt automático."

## Clarifications

### Session 2025-12-28

- Q: Conteúdo do item “Mais” (mobile) → A: Espelho completo da sidebar (todas as rotas não-primárias)
- Q: “Mais” abre como o quê? → A: Um menu/sheet (lista de itens)
- Q: Regra de “dismiss” do banner de instalação (iOS/onde não há prompt nativo) → A: Voltar a mostrar após 7 dias
- Q: Tablet (iPad) — Deal detail abre como? → A: Modal/painel (sem split view nesta entrega)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navegar e operar no mobile com “app shell” (Priority: P1)

Como usuário do CRM no celular, eu quero uma navegação principal simples e sempre acessível para alternar entre Inbox, Boards, Contatos e Atividades, sem a sidebar sobrepor conteúdo, para eu trabalhar com uma mão e sem fricção.

**Why this priority**: É o pré-requisito para toda a experiência “comparável a app” no mobile; resolve o problema base de layout/navegação.

**Independent Test**: Em um viewport de celular, consigo acessar Inbox/Boards/Contatos/Atividades em até 2 toques, e o conteúdo nunca fica escondido pela navegação.

**Acceptance Scenarios**:

1. **Given** o usuário autenticado no CRM em um celular, **When** alterna entre Inbox/Boards/Contatos/Atividades, **Then** cada tela abre corretamente sem sobreposição e com navegação sempre acessível.
2. **Given** o usuário está em uma lista longa no celular, **When** rola a página e usa a navegação principal, **Then** a navegação permanece utilizável e não cobre CTAs essenciais.

---

### User Story 2 - Executar o fluxo de Deal no mobile em Sheet (Priority: P2)

Como usuário no celular, eu quero abrir um deal a partir do Boards e fazer as ações essenciais (ver detalhes, mover estágio, marcar ganho/perdido e criar atividade) em uma experiência de “sheet” fullscreen, para executar o trabalho sem sofrer com modais quebrados.

**Why this priority**: É o fluxo de maior valor do CRM no mobile; sem isso a navegação sozinha não entrega produtividade real.

**Independent Test**: No celular, consigo abrir um deal e concluir uma ação (mover estágio ou marcar ganho/perdido) sem overflow, sem scroll horizontal e sem o teclado esconder o botão de confirmar.

**Acceptance Scenarios**:

1. **Given** um deal existente visível no Boards no celular, **When** o usuário abre o deal, **Then** o detalhe abre em sheet fullscreen com conteúdo legível e ações principais disponíveis.
2. **Given** o usuário está no detalhe do deal no celular, **When** move o estágio do deal, **Then** o estágio muda e o usuário vê confirmação clara da ação.
3. **Given** o usuário está no detalhe do deal no celular, **When** marca ganho ou perdido, **Then** o status do deal é atualizado e a UI reflete o novo estado.

---

### User Story 3 - Instalar o CRM como PWA (Priority: P3)

Como usuário recorrente do CRM no mobile, eu quero receber um convite automático para instalar o CRM na tela inicial e abrir o CRM como um app, para acessar rapidamente e ter uma sensação mais nativa.

**Why this priority**: Aumenta retenção e frequência de uso no mobile; reduz atrito (voltar ao navegador, achar URL, etc.).

**Independent Test**: Em um dispositivo/navegador elegível, o prompt de instalação aparece automaticamente e, após instalar, o CRM abre a partir do ícone e funciona para navegação básica.

**Acceptance Scenarios**:

1. **Given** um usuário acessa o CRM em navegador compatível e elegível, **When** o app detecta elegibilidade, **Then** um CTA/prompt de instalação é exibido automaticamente.
2. **Given** o usuário instala o CRM como PWA, **When** abre pelo ícone da tela inicial, **Then** o CRM abre em modo app e permite navegação entre telas principais.

---

### User Story 4 - Usar o CRM no tablet com Navigation Rail (Priority: P4)

Como usuário no tablet, eu quero uma navegação lateral compacta (rail) para alternar entre as áreas principais sem ocupar o espaço do conteúdo, para trabalhar com mais densidade e conforto.

**Why this priority**: Tablet é um caso forte para CRM; rail dá sensação de app e melhora a ergonomia sem depender do desktop sidebar.

**Independent Test**: Em viewport de tablet, vejo rail e consigo navegar entre telas principais mantendo área de conteúdo ampla.

**Acceptance Scenarios**:

1. **Given** o usuário autenticado em um tablet, **When** alterna entre áreas pelo rail, **Then** a navegação funciona e o conteúdo não fica comprimido nem sobreposto.

### Edge Cases

- O que acontece em telas muito pequenas (ex.: 320px) — navegação continua utilizável sem quebrar layout.
- O que acontece ao girar orientação (portrait/landscape) — conteúdo não perde contexto e não cria sobreposição.
- O que acontece quando o teclado abre em formulários no mobile — CTAs de salvar/confirmar continuam alcançáveis.
- O que acontece quando a sessão expira — usuário é redirecionado para autenticação sem perder estado crítico.
- O que acontece quando o navegador não suporta PWA install prompt — o CRM continua funcionando sem mostrar prompt quebrado.
- O que acontece com conectividade instável — o CRM mostra feedback de erro/sem conexão de forma clara (sem travar UI).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST fornecer navegação principal consistente no mobile para Inbox, Boards, Contatos e Atividades.
- **FR-002**: O sistema MUST garantir que conteúdos e CTAs não sejam cobertos por navegação/overlays em viewports mobile.
- **FR-003**: O sistema MUST permitir executar ações essenciais do deal no mobile (abrir detalhe, mover estágio, marcar ganho/perdido).
- **FR-003a**: Em tablet, o detalhe do deal MUST abrir como modal/painel (não split view) nesta entrega.
- **FR-004**: O sistema MUST permitir criar e concluir atividades no mobile sem quebra de layout.
- **FR-005**: O sistema MUST oferecer uma experiência de detalhes/edição em “sheet” no mobile para fluxos longos.
- **FR-006**: O sistema MUST oferecer suporte à instalação como PWA e exibir prompt automático quando elegível.
- **FR-006a**: O sistema MUST fornecer um item “Mais” no mobile que espelha a navegação completa da sidebar (todas as rotas não-primárias).
- **FR-006b**: O item “Mais” no mobile MUST abrir um menu/sheet com a lista de destinos não-primários (espelho da sidebar).
- **FR-006c**: Quando o banner de instalação do PWA for fechado, o sistema MUST respeitar um cooldown de 7 dias antes de exibir novamente no mesmo dispositivo.
- **FR-007**: O sistema MUST manter isolamento por organização e respeitar permissões do usuário em todas as telas.
- **FR-008**: O sistema MUST apresentar mensagens de erro/sem conexão de forma compreensível em caso de falhas de rede.
- **FR-009**: O sistema MUST funcionar em tablet com navigation rail para as áreas principais.
- **FR-010**: O sistema MUST manter estados de loading previsíveis para evitar “tela vazia” durante carregamentos.

### Key Entities *(include if feature involves data)*

- **NavigationDestination**: Área principal do CRM (Inbox/Boards/Contatos/Atividades/Mais) com rótulo, ícone e rota.
- **InstallState**: Estado de elegibilidade/dispensa/instalação do PWA por usuário/dispositivo.
- **SheetFlow**: Fluxo de detalhe/edição (ex.: Deal detail) com header, body scroll e ações.
- **ResponsiveBreakpoint**: Categorias de layout (mobile/tablet/desktop) com regras de navegação e densidade.
- **Deal/Contact/Activity**: Entidades de negócio existentes que precisam ser operáveis no mobile.

## API, Data & Security Notes *(mandatory if feature touches data or network)*

### API Surface

- **Reads/Writes**: Dados do CRM via interfaces existentes já usadas pelo produto web.
- **Authentication**: Sessão de usuário autenticado.
- **Tenant model**: Acesso sempre escopado por organização (isolamento por tenant) e permissões do usuário.

### Offline/Sync (if applicable)

- **Offline behavior**: Não suportado para operações de dados no MVP; PWA fornece experiência “instalável” e cache leve para abrir a UI.
- **Conflict strategy**: Não aplicável no MVP.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em mobile, usuários conseguem navegar entre Inbox/Boards/Contatos/Atividades em até 2 toques e sem perda de contexto.
- **SC-002**: Em mobile, 95% das sessões de teste não apresentam overflow horizontal nem CTAs cobertos por navegação/overlays.
- **SC-003**: Usuários conseguem completar o fluxo “abrir deal → mover estágio” em menos de 60 segundos em testes guiados.
- **SC-004**: Em dispositivos elegíveis, o prompt automático de instalação do PWA é exibido e ao menos 30% dos usuários recorrentes concluem a instalação em piloto.
- **SC-005**: Em tablet, navegação por rail permite alternar áreas principais sem reduzir a legibilidade do conteúdo (sem truncamento crítico).

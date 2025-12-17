# RBAC (Permissões) — FlowCRM

Data: 2025-12-14

Este documento define as permissões de **admin** e **vendedor** (single-tenant, multiusuário).

## Papéis

- **admin**: usuário com poderes administrativos (gestão de equipe e configurações do sistema).
- **vendedor**: usuário operacional (CRM do dia a dia).

## Regra simples (baseline)

- O **vendedor só não pode**:
  1) **criar/remover/gerenciar usuários** (e convites) e
  2) **mexer nas configurações do sistema**.

- **Exceção**: o vendedor **pode editar o próprio perfil**.

## O que é “configuração do sistema”

Exemplos típicos (admin-only):

- Gestão de equipe/convites
- Webhooks/integrações
- Chaves de API “da empresa” (quando globais)
- Ajustes que afetam todos os usuários (ex.: taxonomias globais: tags/campos personalizados quando forem persistidos no backend)
- Ações perigosas de manutenção (ex.: “zerar database”)

## Preferências pessoais (permitido ao vendedor)

Exemplos típicos (self-service):

- Editar o **próprio** nome, apelido, avatar, etc.
- Preferências de UX (ex.: página inicial)
- Configurações pessoais do assistente/IA (quando são por usuário)

## Regras de implementação (defesa em profundidade)

1) **UI/Rotas**: esconder/limitar seções admin-only no frontend (não é segurança, mas melhora UX e reduz erro).
2) **Server-side**: toda ação admin-only deve ser validada no servidor (Route Handlers / Server Actions / Edge Functions) usando o `profile.role` derivado do usuário autenticado.
3) **Banco/RLS**: tabelas sensíveis devem ter políticas que bloqueiem escrita/leitura indevida. 
4) **Service role**: onde for necessário bypass de RLS, aplicar checagem de role ANTES de qualquer operação.

## Check rápido de conformidade

- [ ] Vendor não acessa gestão de usuários
- [ ] Vendor não altera configurações globais (webhooks/chaves/integrations)
- [ ] Vendor consegue editar o próprio perfil
- [ ] Endpoints e Edge Functions fazem validação server-side
- [ ] Políticas RLS revisadas para tabelas sensíveis

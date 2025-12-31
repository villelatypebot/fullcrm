# US-001 — Abrir um deal no Boards

## História
Como **usuário** do CRM,
eu quero **clicar em um deal no Boards**,
para **ver os detalhes do negócio** sem o app quebrar.

## Critérios de aceitação
- Ao clicar em um deal, deve abrir uma visão de detalhes contendo o **título do deal**.
- Abrir/fechar a visão de detalhes **não pode crashar** (sem “Application error” / sem exceção de hooks).

## Notas
- Este teste existe como regressão do bug que derrubava a app por **hook order mismatch** no `DealDetailModal`.



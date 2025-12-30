# Configuração do GitHub Copilot Code Review

## Forma Mais Fácil (Recomendada) 🚀

### 1. Habilitar no Perfil do GitHub (Global)

Esta é a forma **mais fácil** e funciona para todos os seus repositórios:

1. Acesse: https://github.com/settings/copilot
2. Procure a seção **"Revisão de código automática pelo Copilot"**
3. **Ative** a opção
4. Pronto! 🎉

Agora o Copilot revisará automaticamente **todos os PRs que você criar** em qualquer repositório.

### 2. Personalizar por Repositório (Opcional)

Se quiser que o Copilot revise **todos os PRs** do repositório (não só os seus), configure via Rulesets:

1. Vá em: `Settings` → `Rules` → `Rulesets` → `New ruleset`
2. Configure:
   - **Nome**: `Copilot Code Review`
   - **Status**: `Active`
   - **Target branches**: `main` (ou todas)
   - **Branch rules**: Marque ✅ **"Require automatic Copilot code review"**
   - Opcional: Marque "Review new pushes" e "Review draft pull requests"
3. Clique em `Create`

### 3. Instruções Personalizadas (Já Configurado ✅)

O arquivo `.github/copilot-instructions.md` já existe e contém:
- Diretrizes de arquitetura do projeto
- Padrões de código
- Regras de segurança multi-tenant
- Diretrizes de code review

O Copilot usará essas instruções automaticamente ao revisar PRs.

## Como Funciona

Quando você criar um PR:

1. ✅ O Copilot revisa automaticamente
2. ✅ Comenta sugestões diretamente no código
3. ✅ Você pode aceitar ou ignorar as sugestões
4. ✅ As revisões seguem as diretrizes em `.github/copilot-instructions.md`

## Requisitos

- ✅ Conta GitHub com Copilot ativo (pago)
- ✅ Repositório com acesso ao Copilot

## Referências

- [Documentação Oficial - Configurando revisão automática](https://docs.github.com/pt/copilot/how-tos/agents/copilot-code-review/configuring-automatic-code-review-by-copilot)
- [Documentação Oficial - Diretrizes de codificação](https://docs.github.com/pt/copilot/how-tos/agents/copilot-code-review/configuring-coding-guidelines)


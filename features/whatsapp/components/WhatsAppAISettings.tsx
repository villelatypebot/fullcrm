'use client';

import { useState, useEffect } from 'react';
import {
  useWhatsAppInstances,
  useWhatsAppAIConfig,
  useUpdateWhatsAppAIConfig,
  useUpdateWhatsAppInstance,
} from '@/lib/query/whatsapp';
import type { WhatsAppAIConfig, AgentTone } from '@/types/whatsapp';
import {
  Bot,
  Save,
  Loader2,
  Clock,
  MessageSquare,
  UserPlus,
  Zap,
} from 'lucide-react';

export function WhatsAppAISettings() {
  const { data: instances } = useWhatsAppInstances();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Auto-select first instance
  useEffect(() => {
    if (instances && instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const selectedInstance = instances?.find(i => i.id === selectedInstanceId);
  const { data: config, isLoading } = useWhatsAppAIConfig(selectedInstanceId ?? undefined);
  const updateConfig = useUpdateWhatsAppAIConfig();
  const updateInstance = useUpdateWhatsAppInstance();

  const [form, setForm] = useState({
    agent_name: '',
    agent_role: '',
    agent_tone: 'professional' as AgentTone,
    system_prompt: '',
    reply_delay_ms: 2000,
    max_messages_per_conversation: 50,
    auto_pause_on_human_reply: true,
    greeting_message: '',
    away_message: '',
    transfer_message: '',
    working_hours_start: '',
    working_hours_end: '',
    working_days: [1, 2, 3, 4, 5],
    outside_hours_message: '',
    auto_create_contact: true,
    auto_create_deal: false,
  });

  // Sync form from config
  useEffect(() => {
    if (config) {
      setForm({
        agent_name: config.agent_name ?? '',
        agent_role: config.agent_role ?? '',
        agent_tone: config.agent_tone ?? 'professional',
        system_prompt: config.system_prompt ?? '',
        reply_delay_ms: config.reply_delay_ms ?? 2000,
        max_messages_per_conversation: config.max_messages_per_conversation ?? 50,
        auto_pause_on_human_reply: config.auto_pause_on_human_reply ?? true,
        greeting_message: config.greeting_message ?? '',
        away_message: config.away_message ?? '',
        transfer_message: config.transfer_message ?? '',
        working_hours_start: config.working_hours_start ?? '',
        working_hours_end: config.working_hours_end ?? '',
        working_days: config.working_days ?? [1, 2, 3, 4, 5],
        outside_hours_message: config.outside_hours_message ?? '',
        auto_create_contact: config.auto_create_contact ?? true,
        auto_create_deal: config.auto_create_deal ?? false,
      });
    }
  }, [config]);

  const handleSave = () => {
    if (!selectedInstanceId) return;
    updateConfig.mutate({
      instanceId: selectedInstanceId,
      ...form,
      working_hours_start: form.working_hours_start || null,
      working_hours_end: form.working_hours_end || null,
    });
  };

  const toggleAI = () => {
    if (!selectedInstance) return;
    updateInstance.mutate({
      id: selectedInstance.id,
      ai_enabled: !selectedInstance.ai_enabled,
    });
  };

  if (!instances || instances.length === 0) {
    return (
      <div className="text-center py-12">
        <Bot className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
        <p className="text-slate-500">Configure uma instância WhatsApp primeiro.</p>
      </div>
    );
  }

  const toneOptions: { value: AgentTone; label: string }[] = [
    { value: 'professional', label: 'Profissional' },
    { value: 'friendly', label: 'Amigável' },
    { value: 'casual', label: 'Casual' },
    { value: 'formal', label: 'Formal' },
  ];

  const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  return (
    <div className="space-y-6">
      {/* Instance selector */}
      {instances.length > 1 && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Instância
          </label>
          <select
            value={selectedInstanceId ?? ''}
            onChange={(e) => setSelectedInstanceId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
          >
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} {inst.phone ? `(${inst.phone})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* AI Toggle */}
      <div className="flex items-center justify-between p-4 bg-violet-500/5 border border-violet-500/20 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-500/10">
            <Bot className="w-5 h-5 text-violet-500" />
          </div>
          <div>
            <h4 className="font-medium text-slate-900 dark:text-white">Agente de I.A.</h4>
            <p className="text-xs text-slate-500">Respostas automáticas via inteligência artificial</p>
          </div>
        </div>
        <button
          onClick={toggleAI}
          className={`relative w-12 h-7 rounded-full transition-colors ${
            selectedInstance?.ai_enabled ? 'bg-violet-500' : 'bg-slate-300 dark:bg-white/20'
          }`}
        >
          <div
            className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-sm transition-transform ${
              selectedInstance?.ai_enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Agent Persona */}
          <section className="space-y-4">
            <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
              <Bot className="w-4 h-4" />
              Persona do Agente
            </h4>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
                <input
                  type="text"
                  value={form.agent_name}
                  onChange={(e) => setForm({ ...form, agent_name: e.target.value })}
                  placeholder="Assistente FullHouse"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Papel</label>
                <input
                  type="text"
                  value={form.agent_role}
                  onChange={(e) => setForm({ ...form, agent_role: e.target.value })}
                  placeholder="Atendente virtual"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tom</label>
              <div className="flex gap-2 flex-wrap">
                {toneOptions.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setForm({ ...form, agent_tone: t.value })}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      form.agent_tone === t.value
                        ? 'bg-violet-500 text-white'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Prompt do sistema (instruções para a I.A.)
              </label>
              <textarea
                rows={5}
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                placeholder="Você é um assistente virtual de atendimento..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm resize-y"
              />
            </div>
          </section>

          {/* Messages */}
          <section className="space-y-4">
            <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
              <MessageSquare className="w-4 h-4" />
              Mensagens automáticas
            </h4>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Saudação (primeira mensagem)
              </label>
              <textarea
                rows={2}
                value={form.greeting_message}
                onChange={(e) => setForm({ ...form, greeting_message: e.target.value })}
                placeholder="Olá! Bem-vindo à FullHouse. Como posso ajudar?"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Mensagem de transferência (quando I.A. pausa)
              </label>
              <input
                type="text"
                value={form.transfer_message}
                onChange={(e) => setForm({ ...form, transfer_message: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
              />
            </div>
          </section>

          {/* Working Hours */}
          <section className="space-y-4">
            <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
              <Clock className="w-4 h-4" />
              Horário de atendimento
            </h4>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Início</label>
                <input
                  type="time"
                  value={form.working_hours_start}
                  onChange={(e) => setForm({ ...form, working_hours_start: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fim</label>
                <input
                  type="time"
                  value={form.working_hours_end}
                  onChange={(e) => setForm({ ...form, working_hours_end: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Dias</label>
              <div className="flex gap-2">
                {dayLabels.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const days = form.working_days.includes(i)
                        ? form.working_days.filter((x) => x !== i)
                        : [...form.working_days, i].sort();
                      setForm({ ...form, working_days: days });
                    }}
                    className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                      form.working_days.includes(i)
                        ? 'bg-primary-500 text-white'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Mensagem fora do horário
              </label>
              <input
                type="text"
                value={form.outside_hours_message}
                onChange={(e) => setForm({ ...form, outside_hours_message: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
              />
            </div>
          </section>

          {/* Behavior */}
          <section className="space-y-4">
            <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
              <Zap className="w-4 h-4" />
              Comportamento
            </h4>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_pause_on_human_reply}
                onChange={(e) => setForm({ ...form, auto_pause_on_human_reply: e.target.checked })}
                className="w-4 h-4 rounded text-primary-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Pausar I.A. automaticamente quando um humano responder
              </span>
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Delay de resposta (ms)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30000}
                  value={form.reply_delay_ms}
                  onChange={(e) => setForm({ ...form, reply_delay_ms: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Limite de msgs por conversa
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.max_messages_per_conversation ?? ''}
                  onChange={(e) => setForm({ ...form, max_messages_per_conversation: Number(e.target.value) || 50 })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-bg text-slate-900 dark:text-white text-sm"
                />
              </div>
            </div>
          </section>

          {/* CRM Integration */}
          <section className="space-y-4">
            <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
              <UserPlus className="w-4 h-4" />
              Integração CRM
            </h4>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_create_contact}
                onChange={(e) => setForm({ ...form, auto_create_contact: e.target.checked })}
                className="w-4 h-4 rounded text-primary-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Criar contato automaticamente no CRM
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_create_deal}
                onChange={(e) => setForm({ ...form, auto_create_deal: e.target.checked })}
                className="w-4 h-4 rounded text-primary-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                Criar negócio automaticamente para novos contatos
              </span>
            </label>
          </section>

          {/* Save */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={updateConfig.isPending}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary-500 text-white font-medium hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {updateConfig.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Salvar configurações
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

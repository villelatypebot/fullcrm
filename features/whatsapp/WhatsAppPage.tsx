'use client';

import { useState } from 'react';
import { ConversationList } from './components/ConversationList';
import { MessageThread } from './components/MessageThread';
import { WhatsAppSetup } from './components/WhatsAppSetup';
import { WhatsAppAISettings } from './components/WhatsAppAISettings';
import { useWhatsAppInstances } from '@/lib/query/whatsapp';
import type { WhatsAppConversation } from '@/types/whatsapp';
import {
  MessageSquare,
  Settings,
  Bot,
  Loader2,
  ArrowLeft,
} from 'lucide-react';

type Tab = 'chat' | 'settings' | 'ai';

export function WhatsAppPage() {
  const { data: instances, isLoading, error } = useWhatsAppInstances();
  const [tab, setTab] = useState<Tab>('chat');
  const [selectedConversation, setSelectedConversation] = useState<WhatsAppConversation | null>(null);

  const hasInstances = instances && instances.length > 0;
  const hasConnected = instances?.some((i) => i.status === 'connected');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    const isTableMissing =
      error.message?.includes('whatsapp_instances') ||
      error.message?.includes('relation') ||
      error.message?.includes('42P01');
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {isTableMissing ? 'Configuração pendente' : 'Erro ao carregar'}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            {isTableMissing
              ? 'As tabelas do WhatsApp ainda não foram criadas no banco de dados. Execute a migration do Supabase para habilitar esse módulo.'
              : `Não foi possível carregar as instâncias do WhatsApp: ${error.message}`}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // If no instances, show setup
  if (!hasInstances) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <div className="p-2 rounded-xl bg-green-500/10">
                <MessageSquare className="w-6 h-6 text-green-500" />
              </div>
              WhatsApp
            </h1>
            <p className="text-slate-500 mt-2">
              Conecte seu WhatsApp ao FullHouse CRM para gerenciar conversas e ativar o agente de I.A.
            </p>
          </div>
          <WhatsAppSetup />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-dark-card border-b border-slate-200 dark:border-white/10">
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={MessageSquare} label="Conversas" />
        <TabButton active={tab === 'ai'} onClick={() => setTab('ai')} icon={Bot} label="Agente I.A." />
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')} icon={Settings} label="Conexão" />
      </div>

      {/* Content */}
      {tab === 'settings' && (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <WhatsAppSetup />
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <WhatsAppAISettings />
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <div className="flex-1 flex min-h-0">
          {/* Conversation list (responsive) */}
          <div
            className={`w-80 shrink-0 ${
              selectedConversation ? 'hidden lg:flex lg:flex-col' : 'flex flex-col flex-1 lg:flex-none'
            }`}
          >
            <ConversationList
              selectedId={selectedConversation?.id}
              onSelect={(conv) => setSelectedConversation(conv)}
              instanceId={hasConnected ? instances?.find((i) => i.status === 'connected')?.id : undefined}
            />
          </div>

          {/* Message thread */}
          <div
            className={`flex-1 min-w-0 ${
              selectedConversation ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'
            }`}
          >
            {selectedConversation ? (
              <>
                {/* Mobile back button */}
                <div className="lg:hidden">
                  <button
                    onClick={() => setSelectedConversation(null)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-primary-500 hover:bg-primary-500/5 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar
                  </button>
                </div>
                <MessageThread conversation={selectedConversation} />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="w-10 h-10 text-green-500/50" />
                  </div>
                  <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                    FullHouse WhatsApp
                  </h3>
                  <p className="text-sm text-slate-500">
                    Selecione uma conversa para começar.
                  </p>
                  {!hasConnected && (
                    <p className="text-xs text-amber-500 mt-3">
                      Conecte seu WhatsApp na aba &quot;Conexão&quot; para receber mensagens.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
          : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

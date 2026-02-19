'use client';

import { useState } from 'react';
import {
  useConversationIntelligence,
  useWhatsAppLabels,
  useAssignLabel,
  useRemoveLabel,
} from '@/lib/query/whatsapp';
import type { WhatsAppConversation, ChatMemory, LeadScore, ConversationLabel, WhatsAppFollowUp } from '@/types/whatsapp';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Brain,
  Flame,
  Thermometer,
  Snowflake,
  Zap,
  Tag,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Target,
  FileText,
  User,
  Heart,
  DollarSign,
  Calendar,
  Shield,
  Star,
  MessageSquare,
  Loader2,
  TrendingUp,
} from 'lucide-react';

interface IntelligencePanelProps {
  conversation: WhatsAppConversation;
}

export function IntelligencePanel({ conversation }: IntelligencePanelProps) {
  const { data, isLoading } = useConversationIntelligence(conversation.id);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['score', 'labels', 'memory']));

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-white dark:bg-dark-card border-l border-slate-200 dark:border-white/10">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-500" />
          Inteligência
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Lead Score */}
        <ScoreSection
          leadScore={data.leadScore}
          expanded={expandedSections.has('score')}
          onToggle={() => toggleSection('score')}
        />

        {/* Labels */}
        <LabelsSection
          labels={data.labels}
          conversationId={conversation.id}
          expanded={expandedSections.has('labels')}
          onToggle={() => toggleSection('labels')}
        />

        {/* Memory */}
        <MemorySection
          memories={data.memories}
          expanded={expandedSections.has('memory')}
          onToggle={() => toggleSection('memory')}
        />

        {/* Follow-ups */}
        <FollowUpsSection
          followUps={data.followUps}
          expanded={expandedSections.has('followups')}
          onToggle={() => toggleSection('followups')}
        />

        {/* Summary */}
        {data.summary && (
          <SummarySection
            summary={data.summary}
            expanded={expandedSections.has('summary')}
            onToggle={() => toggleSection('summary')}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// SCORE SECTION
// =============================================================================

function ScoreSection({
  leadScore,
  expanded,
  onToggle,
}: {
  leadScore: LeadScore | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const score = leadScore?.score ?? 0;
  const temp = leadScore?.temperature ?? 'cold';

  const tempConfig = {
    cold: { icon: Snowflake, color: 'text-blue-500', bg: 'bg-blue-500', label: 'Frio' },
    warm: { icon: Thermometer, color: 'text-amber-500', bg: 'bg-amber-500', label: 'Morno' },
    hot: { icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500', label: 'Quente' },
    on_fire: { icon: Zap, color: 'text-red-500', bg: 'bg-red-500', label: 'On Fire' },
  }[temp];

  const TempIcon = tempConfig.icon;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TempIcon className={`w-4 h-4 ${tempConfig.color}`} />
          <span className="text-xs font-semibold text-slate-900 dark:text-white">Lead Score</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${tempConfig.color}`}>{score}/100</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${tempConfig.bg}`}>
            {tempConfig.label}
          </span>
          {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </div>
      </button>

      {expanded && leadScore && (
        <div className="px-3 pb-3 space-y-2">
          {/* Score bar */}
          <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${tempConfig.bg}`}
              style={{ width: `${score}%` }}
            />
          </div>

          {/* Buying stage */}
          {leadScore.buying_stage && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Target className="w-3 h-3" />
              Estágio: <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{leadScore.buying_stage.replace('_', ' ')}</span>
            </div>
          )}

          {/* Score factors */}
          {leadScore.factors && Object.keys(leadScore.factors).length > 0 && (
            <div className="space-y-1">
              {Object.entries(leadScore.factors).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className={`font-medium ${value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    {value > 0 ? '+' : ''}{value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// LABELS SECTION
// =============================================================================

function LabelsSection({
  labels,
  conversationId,
  expanded,
  onToggle,
}: {
  labels: ConversationLabel[];
  conversationId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const { data: allLabels } = useWhatsAppLabels();
  const assignLabel = useAssignLabel();
  const removeLabel = useRemoveLabel();

  const assignedLabelIds = new Set(labels.map((l) => l.label_id));
  const availableLabels = allLabels?.filter((l) => !assignedLabelIds.has(l.id)) ?? [];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-semibold text-slate-900 dark:text-white">Etiquetas</span>
        </div>
        <div className="flex items-center gap-1.5">
          {labels.length > 0 && (
            <span className="text-[10px] font-medium text-slate-500">{labels.length}</span>
          )}
          {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Assigned labels */}
          <div className="flex flex-wrap gap-1.5">
            {labels.map((cl) => (
              <span
                key={cl.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium text-white"
                style={{ backgroundColor: cl.label?.color || '#6366f1' }}
              >
                {cl.label?.name || 'Label'}
                <button
                  onClick={() => removeLabel.mutate({ conversationId, labelId: cl.label_id })}
                  className="hover:opacity-80 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {/* Add button */}
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-white/10 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/20 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Adicionar
            </button>
          </div>

          {/* Add label dropdown */}
          {showAdd && availableLabels.length > 0 && (
            <div className="bg-slate-50 dark:bg-dark-bg rounded-lg p-2 space-y-1">
              {availableLabels.map((label) => (
                <button
                  key={label.id}
                  onClick={() => {
                    assignLabel.mutate({ conversationId, labelId: label.id });
                    setShowAdd(false);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white dark:hover:bg-white/5 transition-colors"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    {label.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MEMORY SECTION
// =============================================================================

const memoryIcons: Record<string, typeof Brain> = {
  family: Heart,
  preference: Star,
  budget: DollarSign,
  timeline: Calendar,
  objection: Shield,
  interest: Target,
  personal: User,
  fact: FileText,
  interaction: MessageSquare,
};

function MemorySection({
  memories,
  expanded,
  onToggle,
}: {
  memories: ChatMemory[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-pink-500" />
          <span className="text-xs font-semibold text-slate-900 dark:text-white">Memória</span>
        </div>
        <div className="flex items-center gap-1.5">
          {memories.length > 0 && (
            <span className="text-[10px] font-medium text-slate-500">{memories.length} fatos</span>
          )}
          {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {memories.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic">
              A I.A. ainda não extraiu memórias desta conversa.
            </p>
          ) : (
            <div className="space-y-1.5">
              {memories.map((mem) => {
                const Icon = memoryIcons[mem.memory_type] || Brain;
                return (
                  <div key={mem.id} className="flex items-start gap-2 text-[11px]">
                    <Icon className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {mem.key}:
                      </span>{' '}
                      <span className="text-slate-500">{mem.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// FOLLOW-UPS SECTION
// =============================================================================

function FollowUpsSection({
  followUps,
  expanded,
  onToggle,
}: {
  followUps: WhatsAppFollowUp[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const pending = followUps.filter((f) => f.status === 'pending');
  const sent = followUps.filter((f) => f.status === 'sent');

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-500" />
          <span className="text-xs font-semibold text-slate-900 dark:text-white">Follow-ups</span>
        </div>
        <div className="flex items-center gap-1.5">
          {pending.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500 text-white">
              {pending.length} pendente{pending.length > 1 ? 's' : ''}
            </span>
          )}
          {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {followUps.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic">
              Nenhum follow-up agendado.
            </p>
          ) : (
            <>
              {pending.map((f) => (
                <div key={f.id} className="flex items-start gap-2 p-2 bg-cyan-500/5 rounded-lg border border-cyan-500/20">
                  <Clock className="w-3.5 h-3.5 text-cyan-500 mt-0.5 shrink-0" />
                  <div className="text-[11px]">
                    <div className="font-medium text-slate-700 dark:text-slate-300">
                      {formatDistanceToNow(new Date(f.trigger_at), { addSuffix: true, locale: ptBR })}
                    </div>
                    <div className="text-slate-500">
                      Intent: <span className="font-medium">{f.detected_intent?.replace(/_/g, ' ') || 'manual'}</span>
                    </div>
                    {f.original_customer_message && (
                      <div className="text-slate-400 mt-1 italic truncate">
                        &ldquo;{f.original_customer_message.slice(0, 60)}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {sent.length > 0 && (
                <div className="text-[10px] text-slate-400">
                  {sent.length} follow-up{sent.length > 1 ? 's' : ''} já enviado{sent.length > 1 ? 's' : ''}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SUMMARY SECTION
// =============================================================================

function SummarySection({
  summary,
  expanded,
  onToggle,
}: {
  summary: NonNullable<ReturnType<typeof useConversationIntelligence>['data']>['summary'];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!summary) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-semibold text-slate-900 dark:text-white">Resumo</span>
        </div>
        {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
            {summary.summary}
          </p>

          {summary.key_points && summary.key_points.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-slate-500 uppercase">Pontos-chave</span>
              {summary.key_points.map((point, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                  <span className="text-emerald-500 mt-0.5">&#x2022;</span>
                  {point}
                </div>
              ))}
            </div>
          )}

          {summary.next_actions && summary.next_actions.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-slate-500 uppercase">Próximas ações</span>
              {summary.next_actions.map((action, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                  <span className="text-cyan-500 mt-0.5">&#x2192;</span>
                  {action}
                </div>
              ))}
            </div>
          )}

          <div className="text-[10px] text-slate-400">
            {format(new Date(summary.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
          </div>
        </div>
      )}
    </div>
  );
}

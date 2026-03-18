import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { TrendingUp, TrendingDown, Users, DollarSign, Target, Clock, MoreVertical, AlertTriangle } from 'lucide-react';
import { StatCard } from './components/StatCard';
import { PipelineAlertsModal } from './components/PipelineAlertsModal';
import { useDashboardMetrics } from './hooks/useDashboardMetrics';
import { LazyFunnelChart, ChartWrapper } from '@/components/charts';


/**
 * Formata a variação percentual para exibição
 */
function formatChange(value: number): { text: string; isPositive: boolean } {
  const isPositive = value >= 0;
  const sign = isPositive ? '+' : '';
  return {
    text: `${sign}${value.toFixed(1)}%`,
    isPositive,
  };
}

/**
 * Componente React `DashboardPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const DashboardPage: React.FC = () => {
  const router = useRouter();
  const { activities, lifecycleStages, contacts, boards } = useCRM();
  const { addToast } = useToast();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showPipelineAlerts, setShowPipelineAlerts] = useState(false);

  // Calcular contagem de contatos por estágio de ciclo de vida
  const stageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    contacts.forEach(contact => {
      if (contact.stage) {
        counts[contact.stage] = (counts[contact.stage] || 0) + 1;
      }
    });
    return counts;
  }, [contacts]);

  useEffect(() => {
    console.log('DashboardPage mounted');
  }, []);

  const {
    isLoading,
    conversationsCount,
    winRate,
    coldLeadsCount,
    interestedAndClientsCount,
    wonRevenue,
    funnelData,
    avgTicket,
    activeContactsCount,
    stoppedContactsCount,
    leadsInFollowUpCount,
    activeSnapshotDeals,
    riskyCount,
    stagnantDealsCount,
  } = useDashboardMetrics(selectedDate);

  // Formatar variações para exibição
  // Variações removidas por simplicidade na nova view diária

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] space-y-4">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Visão Geral
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            O pulso do seu negócio em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          <button
            onClick={() => setShowPipelineAlerts(true)}
            className={`p-2 rounded-lg border transition-colors relative ${(riskyCount > 0 || stagnantDealsCount > 0)
              ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 text-amber-600 dark:text-amber-400'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700'
              }`}
            title="Alertas de Pipeline"
          >
            <AlertTriangle size={20} />
            {(riskyCount > 0 || stagnantDealsCount > 0) && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-slate-900"></span>
            )}
            <span className="sr-only">Alertas de Pipeline</span>
          </button>

          {/* Button removed */}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <StatCard
          title="Conversas (Dia)"
          value={conversationsCount.toString()}
          subtext=""
          icon={Users}
          color="bg-blue-500"
          onClick={() => {}}
        />
        <StatCard
          title="Conversão"
          value={`${winRate.toFixed(1)}%`}
          subtext=""
          icon={Target}
          color="bg-emerald-500"
          onClick={() => {}}
        />
        <StatCard
          title="Leads Frios"
          value={coldLeadsCount.toString()}
          subtext=""
          icon={TrendingDown}
          color="bg-slate-500"
          onClick={() => router.push('/contacts?stage=ALL')}
        />
        <StatCard
          title="Interessados & Clientes"
          value={interestedAndClientsCount.toString()}
          subtext=""
          icon={Users}
          color="bg-purple-500"
          onClick={() => router.push('/contacts?stage=INTERESTED')}
        />
        <StatCard
          title="Receita (Ganha)"
          value={`$${wonRevenue.toLocaleString()}`}
          subtext=""
          icon={TrendingUp}
          color="bg-orange-500"
          onClick={() => {}}
        />
      </div>

      {/* Pipeline Distribution Section - Compact */}
      <div className="space-y-3 shrink-0">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
          <Target className="text-primary-500" size={20} />
          Distribuição do Pipeline
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-primary-500/50 transition-colors"
            onClick={() => router.push('/contacts')}
          >
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              Status do Funil
            </h3>
            <div className="flex justify-between mt-2 text-sm text-slate-700 dark:text-slate-200 font-medium">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div> Em Andamento: {activeContactsCount}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div> Parados: {stoppedContactsCount}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">Distribuição entre contatos que continuam avançando vs. os que estão estagnados.</p>
          </div>

          <div
            className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-amber-500/50 transition-colors"
            onClick={() => setShowPipelineAlerts(true)}
          >
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              Leads em Follow Up
            </h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {leadsInFollowUpCount} Leads
              </span>
              <span className={`text-xs font-bold mb-1 ${leadsInFollowUpCount > 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                Ativos
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Leads que estão atualmente em um fluxo de follow up.
            </p>
          </div>

          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              Ticket Médio
            </h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                ${avgTicket.toLocaleString()}
              </span>
              <span className="text-xs text-green-500 font-bold mb-1">Médio</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Valor médio baseado nas reservas (Receita / Reservas Feitas).</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6 flex-1 min-h-[300px]">
        {/* Funnel */}
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col h-full w-full max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Funil de Vendas & Reservas
            </h2>
          </div>
          <div className="flex-1 min-h-0 relative">
            <div className="absolute inset-0">
              <ChartWrapper height="100%">
                <LazyFunnelChart data={funnelData} />
              </ChartWrapper>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Alerts Modal */}
      <PipelineAlertsModal
        isOpen={showPipelineAlerts}
        onClose={() => setShowPipelineAlerts(false)}
        deals={activeSnapshotDeals}
        activities={activities.map(a => ({ dealId: a.dealId, date: a.date, completed: a.completed }))}
        onNavigateToDeal={(dealId) => {
          setShowPipelineAlerts(false);
          router.push(`/pipeline?deal=${dealId}`);
        }}
      />
    </div>
  );
};

export default DashboardPage;

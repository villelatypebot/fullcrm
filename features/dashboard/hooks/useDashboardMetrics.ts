import React, { useEffect, useState } from 'react';
import { useDeals } from '@/lib/query/hooks/useDealsQuery';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import { useBoards, useDefaultBoard } from '@/lib/query/hooks/useBoardsQuery';
import { createClient } from '@/lib/supabase/client';

export type PeriodFilter = string;
export const PERIOD_LABELS: Record<string, string> = {};
export const COMPARISON_LABELS: Record<string, string> = {};

export const useDashboardMetrics = (dateStr: string) => {
  const { data: allDeals = [], isLoading: dealsLoading } = useDeals();
  const { data: allContacts = [], isLoading: contactsLoading } = useContacts();
  const { data: boards = [] } = useBoards();
  const { data: defaultBoard } = useDefaultBoard();

  const [conversationsCount, setConversationsCount] = useState(0);
  const [isConversationsLoading, setIsConversationsLoading] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    let isMounted = true;
    const fetchConversations = async () => {
      if (!supabase) return;
      setIsConversationsLoading(true);
      try {
        const startOfDay = new Date(dateStr);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(dateStr);
        endOfDay.setHours(23, 59, 59, 999);

        const { count, error } = await supabase
          .from('whatsapp_messages')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfDay.toISOString())
          .lte('created_at', endOfDay.toISOString());
          
        if (error) console.error('Error fetching conversations:', error);
        if (isMounted) {
          setConversationsCount(count || 0);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsConversationsLoading(false);
      }
    };

    fetchConversations();
    return () => { isMounted = false; };
  }, [dateStr, supabase]);

  const isLoading = dealsLoading || contactsLoading || isConversationsLoading;

  const startOfDay = new Date(dateStr);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(dateStr);
  endOfDay.setHours(23, 59, 59, 999);

  const wonDeals = allDeals.filter(d => {
    if (!d.isWon) return false;
    const dt = d.updatedAt ? new Date(d.updatedAt) : new Date(d.createdAt);
    return dt >= startOfDay && dt <= endOfDay;
  });

  const wonRevenue = wonDeals.reduce((acc, deal) => acc + deal.value, 0);

  const totalClosedToday = allDeals.filter(d => {
    const isClosed = d.isWon || d.isLost;
    if (!isClosed) return false;
    const dt = d.updatedAt ? new Date(d.updatedAt) : new Date();
    return dt >= startOfDay && dt <= endOfDay;
  });
  
  const winRate = totalClosedToday.length > 0 
    ? (wonDeals.length / totalClosedToday.length) * 100 
    : 0;

  const coldLeadsCount = allContacts.filter(c => c.temperature === 'cold').length;
  const interestedAndClientsCount = allContacts.filter(c => c.stage === 'INTERESTED' || c.stage === 'CUSTOMER').length;

  const tenDaysAgoTs = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const activeSnapshotDeals = allDeals.filter(d => !d.isWon && !d.isLost);
  
  let stagnantDealsCount = 0;
  for (const deal of activeSnapshotDeals) {
    const lastChangeTs = deal.lastStageChangeDate ? Date.parse(deal.lastStageChangeDate) : Date.parse(deal.createdAt);
    if (lastChangeTs < tenDaysAgoTs) {
      stagnantDealsCount += 1;
    }
  }

  const stoppedContactsCount = stagnantDealsCount; 
  const activeContactsCount = activeSnapshotDeals.length - stoppedContactsCount; 

  const leadsInFollowUpCount = allContacts.filter(c => c.status === 'ACTIVE' && c.stage !== 'CUSTOMER').length;

  const totalWonDealsEver = allDeals.filter(d => d.isWon);
  const totalRevenueEver = totalWonDealsEver.reduce((acc, deal) => acc + deal.value, 0);
  const avgTicket = totalWonDealsEver.length > 0 ? Math.round(totalRevenueEver / totalWonDealsEver.length) : 0;

  const riskyCount = stagnantDealsCount;

  const funnelData = React.useMemo(() => {
    const defaultB = defaultBoard || boards[0];
    const stages = defaultB?.stages || [];
    
    const COLOR_MAP: Record<string, string> = {
      'bg-blue-500': '#3b82f6',
      'bg-green-500': '#22c55e',
      'bg-yellow-500': '#eab308',
      'bg-orange-500': '#f97316',
      'bg-red-500': '#ef4444',
      'bg-purple-500': '#a855f7',
    };

    if (stages.length === 0) {
      return [
        { name: 'Em aberto', count: activeSnapshotDeals.length, fill: '#3b82f6' },
        { name: 'Ganho', count: allDeals.filter(d => d.isWon).length, fill: '#22c55e' },
      ];
    }

    return stages.map(stage => ({
      name: stage.label,
      count: activeSnapshotDeals.filter(d => d.status === stage.id).length,
      fill: COLOR_MAP[stage.color] || '#3b82f6',
    }));
  }, [activeSnapshotDeals, defaultBoard, boards, allDeals]);

  return {
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
  };
};

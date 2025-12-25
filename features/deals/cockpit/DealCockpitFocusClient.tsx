'use client';

import React, { useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/context/CRMContext';
import { useMoveDealSimple } from '@/lib/query/hooks';
import { FocusContextPanel } from '@/features/inbox/components/FocusContextPanel';
import type { Activity, DealView } from '@/types';

/**
 * Cockpit "verdadeiro" (original): UI do Focus (Inbox) reaproveitada fora do /inbox.
 *
 * Motivation:
 * - O usuário considera o cockpit do Focus como a experiência canônica.
 * - Mantemos a rota `/deals/[dealId]/cockpit` apontando para esta UI até a V2 ser "lançada".
 */
export default function DealCockpitFocusClient({ dealId }: { dealId: string }) {
  const router = useRouter();

  const {
    deals,
    contacts,
    boards,
    activeBoard,
    activities,
    updateDeal,
    addActivity,
    updateActivity,
  } = useCRM();

  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  const deal = dealsById.get(dealId) as DealView | undefined;
  const contact = deal ? (contactsById.get(deal.contactId) ?? undefined) : undefined;
  const board = deal ? (boardsById.get(deal.boardId) ?? activeBoard) : activeBoard;

  const dealActivities = useMemo(() => {
    if (!deal) return [] as Activity[];
    // Mantém consistência com a experiência do Focus: filtra por dealId.
    return activities.filter((a) => a.dealId === deal.id);
  }, [activities, deal]);

  const { moveDeal } = useMoveDealSimple(board ?? null, []);

  const onMoveStage = useCallback(
    (stageId: string) => {
      if (!deal) return;
      moveDeal(deal, stageId);
    },
    [deal, moveDeal]
  );

  const onMarkWon = useCallback(() => {
    if (!deal) return;
    updateDeal(deal.id, { isWon: true, isLost: false, closedAt: new Date().toISOString() });
  }, [deal, updateDeal]);

  const onMarkLost = useCallback(() => {
    if (!deal) return;
    updateDeal(deal.id, { isWon: false, isLost: true, closedAt: new Date().toISOString() });
  }, [deal, updateDeal]);

  if (!deal) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Negócio não encontrado. Volte e tente novamente.
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-9999 bg-black/50 backdrop-blur-sm">
      <FocusContextPanel
        className="h-full w-full"
        isExpanded={true}
        deal={deal}
        contact={contact}
        board={board ?? undefined}
        activities={dealActivities}
        onMoveStage={onMoveStage}
        onMarkWon={onMarkWon}
        onMarkLost={onMarkLost}
        onAddActivity={addActivity}
        onUpdateActivity={updateActivity}
        onClose={() => router.back()}
      />
    </div>
  );
}


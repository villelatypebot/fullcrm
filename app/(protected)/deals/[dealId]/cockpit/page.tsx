import DealCockpitFocusClient from '@/features/deals/cockpit/DealCockpitFocusClient';

/**
 * Cockpit (verdadeiro/original) - UI do Focus (Inbox) como rota canônica.
 * URL: /deals/[dealId]/cockpit
 */
export default async function DealCockpitPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return <DealCockpitFocusClient dealId={dealId} />;
}

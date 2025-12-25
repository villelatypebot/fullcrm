import DealCockpitClient from '@/features/deals/cockpit/DealCockpitClient';

/**
 * Cockpit V2 (experimentação / rollout controlado).
 * URL: /deals/[dealId]/cockpit-v2
 */
export default async function DealCockpitV2Page({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return <DealCockpitClient dealId={dealId} />;
}


'use client';

import dynamic from 'next/dynamic';

const WhatsAppPage = dynamic(
  () => import('@/features/whatsapp/WhatsAppPage').then((m) => ({ default: m.WhatsAppPage })),
  {
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    ),
    ssr: false,
  },
);

export default function WhatsAppRoute() {
  return <WhatsAppPage />;
}

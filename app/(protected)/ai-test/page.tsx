import { notFound } from 'next/navigation';
import { UIChat } from '@/components/ai/UIChat';

/**
 * Test page for AI SDK UI integration
 * Access at: /ai-test
 */
export default function AITestPage() {
    const isEnabled =
        process.env.NODE_ENV === 'development' &&
        String(process.env.ALLOW_AI_TEST_ROUTE).toLowerCase() === 'true';

    if (!isEnabled) {
        notFound();
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-4">
            <div className="max-w-2xl mx-auto">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                        🧪 AI SDK UI Test
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Testando useChat com Route Handler + streamText
                    </p>
                </header>

                <div className="h-150 overflow-hidden">
                    <UIChat />
                </div>
            </div>
        </div>
    );
}

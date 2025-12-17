'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Loader2, Bot, User, Sparkles, Wrench, X, MessageCircle, Minimize2, Maximize2 } from 'lucide-react';
import { useAI } from '@/context/AIContext';

type ActiveObjectMetadata = {
    boardId?: string;
    dealId?: string;
    contactId?: string;
    stages?: Array<{ id: string; name: string }>;
    dealCount?: number;
    pipelineValue?: number;
    stagnantDeals?: number;
    overdueDeals?: number;
    wonStage?: string;
    lostStage?: string;
};

export interface UIChatProps {
    /** Optional explicit context (overrides provider context) */
    boardId?: string;
    dealId?: string;
    contactId?: string;
    /** Whether to show as a floating widget */
    floating?: boolean;
    /** Starting minimized state (for floating) */
    startMinimized?: boolean;
    /** On close callback (for floating) */
    onClose?: () => void;
}

/**
 * UI Chat Component using AI SDK UI
 * Uses Route Handler at /api/ai/chat with streaming and context support
 * Reads context from AIContext (set by pages like Boards)
 */
export function UIChat({
    boardId,
    dealId,
    contactId,
    floating = false,
    startMinimized = true,
    onClose
}: UIChatProps) {
    const { activeContext } = useAI();
    const [isOpen, setIsOpen] = useState(!startMinimized);
    const [isExpanded, setIsExpanded] = useState(false);

    // Extract FULL context from AIContext for AI SDK v6
    const metadata = activeContext?.activeObject?.metadata as ActiveObjectMetadata | undefined;

    // Build rich context with all available info
    const context = useMemo(() => ({
        // Core IDs
        boardId: boardId ?? metadata?.boardId,
        dealId: dealId ?? metadata?.dealId,
        contactId: contactId ?? metadata?.contactId,

        // Board Context
        boardName: activeContext?.activeObject?.name,
        stages: metadata?.stages,

        // Metrics
        dealCount: metadata?.dealCount,
        pipelineValue: metadata?.pipelineValue,
        stagnantDeals: metadata?.stagnantDeals,
        overdueDeals: metadata?.overdueDeals,

        // Board Config
        wonStage: metadata?.wonStage,
        lostStage: metadata?.lostStage,
    }), [
        boardId, dealId, contactId,
        metadata?.boardId, metadata?.dealId, metadata?.contactId,
        activeContext?.activeObject?.name,
        metadata?.stages, metadata?.dealCount, metadata?.pipelineValue,
        metadata?.stagnantDeals, metadata?.overdueDeals,
        metadata?.wonStage, metadata?.lostStage
    ]);

    console.log('[UIChat Debug] Context ready:', {
        id: `chat-${context.boardId || context.dealId || 'global'}`,
        boardId: context.boardId,
        boardName: context.boardName
    });

    // Use transport with dynamic body function + maxSteps for approval flow
    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: '/api/ai/chat',
                body: { context },
            }),
        [context]
    );

    const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({
        transport,
        // @ts-expect-error - maxSteps is required for approval flow; types may be outdated
        maxSteps: 10,
    });

    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        }
    }, [isOpen]);

    // DEBUG: Log status changes
    useEffect(() => {
        console.log('[UIChat] Status:', status, 'Error:', error);
    }, [status, error]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        console.log('[UIChat] Submit attempt:', { input, status, isLoading: status !== 'ready' });
        if (input.trim() && status === 'ready') {
            sendMessage({ text: input });
            setInput('');
        }
    };

    const isLoading = status === 'streaming' || status === 'submitted';

    // Quick action buttons
    const quickActions = [
        { label: '📊 Analisar Pipeline', prompt: 'Analise meu pipeline de vendas' },
        { label: '⏰ Deals Parados', prompt: 'Quais deals estão parados há mais de 7 dias?' },
        { label: '🔍 Buscar', prompt: 'Buscar ' },
    ];

    // Floating minimized button
    if (floating && !isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-50 p-4 bg-gradient-to-r from-primary-600 to-violet-600 hover:from-primary-500 hover:to-violet-500 text-white rounded-full shadow-lg shadow-primary-500/25 transition-all hover:scale-105"
            >
                <MessageCircle className="w-6 h-6" />
            </button>
        );
    }

    // Chat content as JSX (not a component function to preserve input state)
    const chatContent = (
        <>
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-700/50">
                <div className="p-2 bg-gradient-to-br from-primary-500/20 to-violet-500/20 rounded-xl">
                    <Sparkles className="w-5 h-5 text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-white">NossoCRM Pilot</h2>
                    <p className="text-xs text-slate-400 truncate">
                        {context.boardId ? `Board: ${context.boardId.slice(0, 8)}...` :
                            context.dealId ? `Deal: ${context.dealId.slice(0, 8)}...` :
                                'AI Assistant'}
                    </p>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs ${status === 'ready'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/20 text-amber-400'
                    }`}>
                    {status === 'ready' ? 'Pronto' : 'Pensando...'}
                </div>
                {floating && (
                    <div className="flex gap-1">
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-1 hover:bg-slate-700/50 rounded-lg transition-colors"
                            title={isExpanded ? 'Reduzir' : 'Expandir'}
                        >
                            <Maximize2 className="w-4 h-4 text-slate-400" />
                        </button>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1 hover:bg-slate-700/50 rounded-lg transition-colors"
                            title="Minimizar"
                        >
                            <Minimize2 className="w-4 h-4 text-slate-400" />
                        </button>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="p-1 hover:bg-slate-700/50 rounded-lg transition-colors"
                                title="Fechar"
                            >
                                <X className="w-4 h-4 text-slate-400" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                        <div className="p-3 bg-gradient-to-br from-primary-500/20 to-violet-500/20 rounded-2xl">
                            <Bot className="w-10 h-10 text-primary-400" />
                        </div>
                        <div>
                            <p className="text-slate-300 mb-1">Como posso ajudar?</p>
                            <p className="text-slate-500 text-xs">
                                Pipeline • Deals • Contatos • Tarefas
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center">
                            {quickActions.map((action) => (
                                <button
                                    key={action.label}
                                    onClick={() => {
                                        setInput(action.prompt);
                                        inputRef.current?.focus();
                                    }}
                                    className="px-3 py-1.5 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-600/50 rounded-lg text-xs text-slate-300 transition-all"
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        {message.role === 'assistant' && (
                            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-violet-500 flex items-center justify-center">
                                <Bot className="w-3.5 h-3.5 text-white" />
                            </div>
                        )}
                        <div className={`max-w-[85%] ${message.role === 'user'
                            ? 'bg-primary-600 text-white rounded-2xl rounded-tr-sm'
                            : 'bg-slate-800/80 text-slate-200 rounded-2xl rounded-tl-sm border border-slate-700/50'
                            } px-3 py-2`}>

                            {message.parts.map((part, index) => {
                                if (part.type === 'text') {
                                    return (
                                        <p key={index} className="text-sm whitespace-pre-wrap m-0">{part.text}</p>
                                    );
                                }

                                const partType = part.type as string;
                                const isTool = partType === 'tool-invocation' || partType.startsWith('tool-');

                                if (isTool) {
                                    const toolPart = part as any;
                                    const toolName = toolPart.toolName || (partType.startsWith('tool-') ? partType.replace('tool-', '') : 'ferramenta');

                                    console.log('[UIChat] 🔧 Handling tool part:', { type: partType, state: toolPart.state, name: toolName });

                                    if (toolPart.state === 'approval-requested') {
                                        return (
                                            <div key={index} className="mt-2 p-3 bg-amber-900/30 border border-amber-600/50 rounded-lg">
                                                <div className="flex items-center gap-2 text-sm text-amber-200 mb-2">
                                                    <Wrench className="w-4 h-4" />
                                                    <span className="font-medium">Confirmar ação: {toolName}</span>
                                                </div>
                                                <p className="text-xs text-amber-300/70 mb-3">
                                                    {JSON.stringify(toolPart.args || toolPart.input, null, 2)}
                                                </p>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => addToolApprovalResponse?.({
                                                            id: toolPart.approval?.id || toolPart.toolCallId,
                                                            approved: true,
                                                        })}
                                                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg transition-all"
                                                    >
                                                        ✓ Aprovar
                                                    </button>
                                                    <button
                                                        onClick={() => addToolApprovalResponse?.({
                                                            id: toolPart.approval?.id || toolPart.toolCallId,
                                                            approved: false,
                                                        })}
                                                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-all"
                                                    >
                                                        ✗ Negar
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={index} className="flex items-center gap-1.5 text-xs text-slate-400 mt-1.5 p-1.5 bg-slate-900/50 rounded">
                                            <Wrench className="w-3 h-3" />
                                            <span>{toolName}</span>
                                            {toolPart.state === 'result' && <span className="text-emerald-400">✓</span>}
                                            {toolPart.state === 'call' && <Loader2 className="w-3 h-3 animate-spin" />}
                                        </div>
                                    );
                                }

                                return null;
                            })}
                        </div>


                        {
                            message.role === 'user' && (
                                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                                    <User className="w-3.5 h-3.5 text-slate-300" />
                                </div>
                            )
                        }
                    </div>
                ))}

                {isLoading && (
                    <div className="flex gap-2">
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-violet-500 flex items-center justify-center">
                            <Bot className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="bg-slate-800/80 text-slate-400 rounded-2xl rounded-tl-sm px-3 py-2 border border-slate-700/50">
                            <div className="flex items-center gap-2 text-sm">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Pensando...</span>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs">
                        ❌ {error.message}
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            < form onSubmit={handleSubmit} className="p-3 border-t border-slate-700/50" >
                <div className="flex gap-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Pergunte algo..."
                        disabled={status !== 'ready'}
                        className="flex-1 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 transition-all disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || status !== 'ready'}
                        className="px-3 py-2 bg-gradient-to-r from-primary-600 to-violet-600 hover:from-primary-500 hover:to-violet-500 disabled:from-slate-600 disabled:to-slate-700 text-white rounded-xl transition-all disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </form >
        </>
    );

    // Floating widget - size based on isExpanded
    if (floating) {
        // Expanded: Right-side drawer panel
        if (isExpanded) {
            return (
                <>
                    {/* Overlay */}
                    <div
                        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300"
                        onClick={() => setIsExpanded(false)}
                    />
                    {/* Drawer Panel */}
                    <div className="fixed top-0 right-0 z-50 w-full max-w-lg h-full bg-slate-900 border-l border-slate-700/50 shadow-2xl shadow-black/50 flex flex-col transition-transform duration-300">
                        {chatContent}
                    </div>
                </>
            );
        }

        // Minimized: Small widget in corner
        return (
            <div className="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-slate-900/95 rounded-2xl border border-slate-700/50 shadow-2xl shadow-black/50 flex flex-col overflow-hidden backdrop-blur-xl transition-all duration-300">
                {chatContent}
            </div>
        );
    }

    // Inline component
    return (
        <div className="flex flex-col h-full bg-slate-900/50 rounded-2xl border border-slate-700/50 backdrop-blur-xl overflow-hidden">
            {chatContent}
        </div>
    );
}

// Export a floating version that can be added to layout
export function FloatingAIChat() {
    const [isVisible, setIsVisible] = useState(true);

    if (!isVisible) return null;

    return <UIChat floating startMinimized onClose={() => setIsVisible(false)} />;
}

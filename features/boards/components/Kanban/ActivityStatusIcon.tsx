import React from 'react';
import { Phone, Mail, Calendar, ChevronRight, AlertTriangle, ArrowRightLeft } from 'lucide-react';

interface ActivityStatusIconProps {
    status: string;
    type?: string;
    dealId?: string;
    dealTitle?: string;
    isOpen: boolean;
    onToggle: (e: React.MouseEvent) => void;
    onQuickAdd: (type: 'CALL' | 'MEETING' | 'EMAIL') => void;
    /** Optional callback to close the menu without needing an event object */
    onRequestClose?: () => void;
    /** Callback for keyboard-accessible move to stage action */
    onMoveToStage?: () => void;
}

/**
 * ActivityStatusIcon - Shows deal activity status with quick-add menu
 * 
 * Accessibility:
 * - Button has descriptive aria-label based on status
 * - Menu items are proper buttons with visible labels
 * - Menu has role="menu" with proper menuitem roles
 */
export const ActivityStatusIcon: React.FC<ActivityStatusIconProps> = ({
    status,
    type,
    dealId,
    dealTitle,
    isOpen,
    onToggle,
    onQuickAdd,
    onRequestClose,
    onMoveToStage
}) => {
    const Icon = type === 'CALL' ? Phone : type === 'EMAIL' ? Mail : type === 'MEETING' ? Calendar : ChevronRight;

    // Get accessible status description
    const getStatusLabel = () => {
        switch (status) {
            case 'yellow':
                return 'Atenção: Sem atividade agendada';
            case 'red':
                return 'Atividade atrasada';
            case 'green':
                return 'Atividade agendada para hoje';
            default:
                return 'Atividade futura agendada';
        }
    };

    let content;
    switch (status) {
        case 'yellow':
            content = (
                <div className="text-yellow-500" aria-hidden="true">
                    <AlertTriangle size={18} fill="currentColor" className="text-yellow-500/20" />
                </div>
            );
            break;
        case 'red':
            content = (
                <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white shadow-sm ring-1 ring-white dark:ring-dark-card" aria-hidden="true">
                    <Icon size={10} strokeWidth={3} />
                </div>
            );
            break;
        case 'green':
            content = (
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white shadow-sm ring-1 ring-white dark:ring-dark-card" aria-hidden="true">
                    <Icon size={10} strokeWidth={3} />
                </div>
            );
            break;
        default:
            content = (
                <div className="w-5 h-5 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-white ring-1 ring-white dark:ring-dark-card" aria-hidden="true">
                    <Icon size={10} strokeWidth={3} />
                </div>
            );
    }

    return (
        <div className="relative">
            <button 
                type="button"
                onClick={onToggle}
                aria-label={`${getStatusLabel()}. Clique para agendar atividade`}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                className="hover:scale-110 transition-transform cursor-pointer p-1 -m-1 focus-visible-ring rounded-full"
            >
                {content}
            </button>

            {isOpen && dealId && (
                <div
                    role="menu"
                    aria-label="Agendar atividade rápida"
                    className="absolute bottom-full right-0 mb-2 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-white/10 z-50 overflow-hidden animate-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="p-2 border-b border-slate-100 dark:border-white/5">
                        <p className="text-xs font-bold text-slate-500 uppercase px-2" id={`quick-add-heading-${dealId}`}>Ações Rápidas</p>
                    </div>
                    
                    {/* Keyboard-accessible move to stage option */}
                    {onMoveToStage && (
                        <div className="p-1 border-b border-slate-100 dark:border-white/5">
                            <button 
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    onMoveToStage();
                                    onRequestClose?.();
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                            >
                                <ArrowRightLeft size={14} className="text-green-500" aria-hidden="true" /> Mover para estágio...
                            </button>
                        </div>
                    )}
                    
                    <div className="p-1" role="group" aria-labelledby={`quick-add-heading-${dealId}`}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase px-3 py-1">Agendar</p>
                        <button 
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onQuickAdd('CALL');
                                onRequestClose?.();
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                        >
                            <Phone size={14} className="text-blue-500" aria-hidden="true" /> Ligar amanhã
                        </button>
                        <button 
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onQuickAdd('EMAIL');
                                onRequestClose?.();
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                        >
                            <Mail size={14} className="text-purple-500" aria-hidden="true" /> Email amanhã
                        </button>
                        <button 
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onQuickAdd('MEETING');
                                onRequestClose?.();
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                        >
                            <Calendar size={14} className="text-orange-500" aria-hidden="true" /> Reunião amanhã
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

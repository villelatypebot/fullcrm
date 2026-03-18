import React from 'react';
import { Building2, Mail, Phone, Plus, Calendar, Pencil, Trash2, Globe, MoreHorizontal, ArrowUpDown, ArrowUp, ArrowDown, Thermometer } from 'lucide-react';
import { Contact, Company, ContactSortableColumn } from '@/types';
import { StageBadge } from './ContactsStageTabs';

// Performance: reuse Intl formatters (they are relatively expensive to instantiate).
const PT_BR_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');
const PT_BR_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

/**
 * Formata uma data para exibição relativa (ex: "Hoje", "Ontem", "Há 3 dias", "15/11/2024")
 */
function formatRelativeDate(dateString: string | undefined | null, now: Date): string {
    if (!dateString) return '---';
    
    const date = new Date(dateString);
    
    // Reset hours for accurate day comparison
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const diffTime = today.getTime() - dateDay.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Ontem';
    if (diffDays < 7) return `Há ${diffDays} dias`;
    if (diffDays < 30) return `Há ${Math.floor(diffDays / 7)} sem.`;
    
    // For older dates, show the actual date
    return PT_BR_DATE_FORMATTER.format(date);
}

/** Props for sortable column header */
interface SortableHeaderProps {
    label: string;
    column: ContactSortableColumn;
    currentSort: ContactSortableColumn;
    sortOrder: 'asc' | 'desc';
    onSort: (column: ContactSortableColumn) => void;
}

/** Sortable column header component */
const SortableHeader: React.FC<SortableHeaderProps> = ({ label, column, currentSort, sortOrder, onSort }) => {
    const isActive = currentSort === column;
    
    return (
        <th scope="col" className="px-6 py-4">
            <button
                onClick={() => onSort(column)}
                className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider hover:text-primary-600 dark:hover:text-primary-400 transition-colors group"
                aria-label={`Ordenar por ${label}`}
            >
                {label}
                <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                    {isActive ? (
                        sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                    ) : (
                        <ArrowUpDown size={14} />
                    )}
                </span>
            </button>
        </th>
    );
};

interface ContactsListProps {
    filteredContacts: Contact[];
    contacts: Contact[];
    selectedIds: Set<string>;
    toggleSelect: (id: string) => void;
    toggleSelectAll: () => void;
    updateContact: (id: string, data: Partial<Contact>) => void;
    openEditModal: (contact: Contact) => void;
    setDeleteId: (id: string) => void;
    // Sorting props
    sortBy?: ContactSortableColumn;
    sortOrder?: 'asc' | 'desc';
    onSort?: (column: ContactSortableColumn) => void;
}

const TEMPERATURE_CONFIG: Record<string, { label: string; color: string }> = {
    cold: { label: 'Frio', color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' },
    warm: { label: 'Morno', color: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20' },
    hot: { label: 'Quente', color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20' },
    on_fire: { label: 'On Fire', color: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
};

const TemperatureBadge: React.FC<{ temperature?: string; score?: number }> = ({ temperature, score }) => {
    const config = TEMPERATURE_CONFIG[temperature || 'cold'] || TEMPERATURE_CONFIG.cold;
    return (
        <div className="flex items-center gap-1.5">
            <Thermometer size={14} className="text-slate-400" />
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${config.color}`}>
                {config.label}
            </span>
            {typeof score === 'number' && score > 0 && (
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{score}</span>
            )}
        </div>
    );
};

/**
 * Componente React `ContactsList`.
 *
 * @param {ContactsListProps} {
    viewMode,
    filteredContacts,
    filteredCompanies,
    contacts,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    getCompanyName,
    updateContact,
    convertContactToDeal,
    openEditModal,
    setDeleteId,
    sortBy = 'created_at',
    sortOrder = 'desc',
    onSort,
} - Parâmetro `{
    viewMode,
    filteredContacts,
    filteredCompanies,
    contacts,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    getCompanyName,
    updateContact,
    convertContactToDeal,
    openEditModal,
    setDeleteId,
    sortBy = 'created_at',
    sortOrder = 'desc',
    onSort,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsList: React.FC<ContactsListProps> = ({
    filteredContacts,
    contacts,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    updateContact,
    openEditModal,
    setDeleteId,
    sortBy = 'created_at',
    sortOrder = 'desc',
    onSort,
}) => {
    const activeListIds = filteredContacts.map(c => c.id);
    const allSelected = activeListIds.length > 0 && selectedIds.size === activeListIds.length;

    const someSelected = selectedIds.size > 0 && selectedIds.size < activeListIds.length;

    // Performance: compute "contacts by company" once (avoids N filters per company row).
    const contactsByCompanyId = React.useMemo(() => {
        const map = new Map<string, Contact[]>();
        for (const c of contacts) {
            const companyId = c.clientCompanyId;
            if (!companyId) continue;
            const list = map.get(companyId);
            if (list) list.push(c);
            else map.set(companyId, [c]);
        }
        return map;
    }, [contacts]);

    // Performance: avoid creating `new Date()` for each row in formatRelativeDate.
    // Memoized para evitar hydration mismatch (server vs client timestamp) e
    // evitar recriação a cada render
    const now = React.useMemo(() => new Date(), []);
    
    return (
        <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/80 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
                            <tr>
                                <th scope="col" className="w-12 px-6 py-4">
                                    <input 
                                        type="checkbox" 
                                        checked={allSelected}
                                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                        onChange={toggleSelectAll}
                                        aria-label={allSelected ? 'Desmarcar todos os contatos' : 'Selecionar todos os contatos'}
                                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:bg-white/5 dark:border-white/10" 
                                    />
                                </th>
                                {onSort ? (
                                    <SortableHeader label="Nome" column="name" currentSort={sortBy} sortOrder={sortOrder} onSort={onSort} />
                                ) : (
                                    <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Nome</th>
                                )}
                                <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Estágio</th>
                                <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Temp.</th>
                                <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Contato</th>
                                <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Status</th>
                                {onSort ? (
                                    <SortableHeader label="Criado" column="created_at" currentSort={sortBy} sortOrder={sortOrder} onSort={onSort} />
                                ) : (
                                    <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Criado</th>
                                )}
                                {onSort ? (
                                    <SortableHeader label="Modificado" column="updated_at" currentSort={sortBy} sortOrder={sortOrder} onSort={onSort} />
                                ) : (
                                    <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider">Modificado</th>
                                )}
                                <th scope="col" className="px-6 py-4 font-bold text-slate-700 dark:text-slate-200 font-display text-xs uppercase tracking-wider"><span className="sr-only">Ações</span></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                            {filteredContacts.map((contact) => (
                                <tr key={contact.id} className={`hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors group ${selectedIds.has(contact.id) ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}>
                                    <td className="px-6 py-4">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedIds.has(contact.id)}
                                            onChange={() => toggleSelect(contact.id)}
                                            aria-label={`Selecionar ${contact.name}`}
                                            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:bg-white/5 dark:border-white/10" 
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => openEditModal(contact)}
                                                className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900 dark:to-primary-800 text-primary-700 dark:text-primary-200 flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-white dark:ring-white/5 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-dark-card"
                                                aria-label={`Editar contato: ${contact.name || 'Sem nome'}`}
                                                title={contact.name || 'Sem nome'}
                                            >
                                                {(contact.name || '?').charAt(0)}
                                            </button>
                                            <div>
                                                <span className="font-semibold text-slate-900 dark:text-white block">{contact.name}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <StageBadge stage={contact.stage} />
                                    </td>
                                    <td className="px-6 py-4">
                                        <TemperatureBadge temperature={contact.temperature} score={contact.leadScore} />
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs">
                                                <Mail size={12} /> {contact.email || '---'}
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs">
                                                <Phone size={12} /> {contact.phone || '---'}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    const nextStatus = contact.status === 'ACTIVE' ? 'INACTIVE' : contact.status === 'INACTIVE' ? 'CHURNED' : 'ACTIVE';
                                                    updateContact(contact.id, { status: nextStatus });
                                                }}
                                                aria-label={`Alterar status de ${contact.name} de ${contact.status === 'ACTIVE' ? 'ativo' : contact.status === 'INACTIVE' ? 'inativo' : 'perdido'}`}
                                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${contact.status === 'ACTIVE' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20' :
                                                    contact.status === 'INACTIVE' ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20' :
                                                        'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                                                    }`}
                                            >
                                                {contact.status === 'ACTIVE' ? 'ATIVO' : contact.status === 'INACTIVE' ? 'INATIVO' : 'PERDIDO'}
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div
                                            className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs"
                                            title={contact.createdAt ? PT_BR_DATE_TIME_FORMATTER.format(new Date(contact.createdAt)) : undefined}
                                        >
                                            <Calendar size={14} className="text-slate-400" />
                                            <span>{formatRelativeDate(contact.createdAt, now)}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div
                                            className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs"
                                            title={contact.updatedAt ? PT_BR_DATE_TIME_FORMATTER.format(new Date(contact.updatedAt)) : undefined}
                                        >
                                            <Calendar size={14} className="text-slate-400" />
                                            <span>{formatRelativeDate(contact.updatedAt, now)}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                            <button
                                                onClick={() => openEditModal(contact)}
                                                className="p-1.5 text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                                                aria-label={`Editar ${contact.name}`}
                                            >
                                                <Pencil size={16} aria-hidden="true" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteId(contact.id)}
                                                className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-slate-400 hover:text-red-500 transition-colors"
                                                aria-label={`Excluir ${contact.name}`}
                                            >
                                                <Trash2 size={16} aria-hidden="true" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
            </div>
        </div>
    );
};

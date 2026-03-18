import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/context/ToastContext';
import { Contact, Company, ContactStage, PaginationState, ContactsServerFilters, DEFAULT_PAGE_SIZE, ContactSortableColumn } from '@/types';
import {
  useContacts,
  useContactsPaginated,
  useContactStageCounts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useBulkDeleteContacts,
  useContactHasDeals,
} from '@/lib/query/hooks/useContactsQuery';

import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import { normalizePhoneE164 } from '@/lib/phone';
import { generateFakeContacts } from '@/lib/debug';

/**
 * Hook React `useContactsController` que encapsula uma lógica reutilizável.
 * @returns {{ search: string; setSearch: Dispatch<SetStateAction<string>>; statusFilter: "ALL" | "ACTIVE" | "INACTIVE" | "CHURNED" | "RISK"; setStatusFilter: Dispatch<SetStateAction<"ALL" | ... 3 more ... | "RISK">>; ... 51 more ...; addToast: (message: string, type?: ToastType | undefined) => void; }} Retorna um valor do tipo `{ search: string; setSearch: Dispatch<SetStateAction<string>>; statusFilter: "ALL" | "ACTIVE" | "INACTIVE" | "CHURNED" | "RISK"; setStatusFilter: Dispatch<SetStateAction<"ALL" | ... 3 more ... | "RISK">>; ... 51 more ...; addToast: (message: string, type?: ToastType | undefined) => void; }`.
 */
export const useContactsController = () => {
  // T017: Pagination state
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // TanStack Query hooks
  // TanStack Query hooks
  const createContactMutation = useCreateContact();
  const updateContactMutation = useUpdateContact();
  const deleteContactMutation = useDeleteContact();
  const bulkDeleteContactsMutation = useBulkDeleteContacts();
  const checkHasDealsMutation = useContactHasDeals();

  // Enable realtime sync
  useRealtimeSync('contacts');

  const { addToast, showToast } = useToast();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'ACTIVE' | 'INACTIVE' | 'CHURNED' | 'RISK'
  >(() => {
    const filter = searchParams?.get('filter');
    const validFilters = ['ALL', 'ACTIVE', 'INACTIVE', 'CHURNED', 'RISK'] as const;
    return validFilters.includes(filter as (typeof validFilters)[number])
      ? (filter as (typeof validFilters)[number])
      : 'ALL';
  });
  const [stageFilter, setStageFilter] = useState<ContactStage | 'ALL'>(
    (searchParams?.get('stage') as ContactStage) || 'ALL'
  );
  const [viewMode, setViewMode] = useState<'people' | 'companies'>('people');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // Sorting state
  const [sortBy, setSortBy] = useState<ContactSortableColumn>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Toggle sort handler
  const handleSort = useCallback((column: ContactSortableColumn) => {
    if (sortBy === column) {
      // Toggle direction if same column
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to desc
      setSortBy(column);
      setSortOrder('desc');
    }
    // Reset to first page when sorting changes
    setPagination(prev => ({ ...prev, pageIndex: 0 }));
  }, [sortBy]);

  // T027-T028: Build server filters from state
  const serverFilters = useMemo<ContactsServerFilters | undefined>(() => {
    const filters: ContactsServerFilters = {};

    if (search.trim()) {
      filters.search = search.trim();
    }
    if (stageFilter !== 'ALL') {
      filters.stage = stageFilter;
    }
    if (statusFilter !== 'ALL') {
      filters.status = statusFilter;
    }
    if (dateRange.start) {
      filters.dateStart = dateRange.start;
    }
    if (dateRange.end) {
      filters.dateEnd = dateRange.end;
    }

    // Always include sorting
    filters.sortBy = sortBy;
    filters.sortOrder = sortOrder;

    // Return filters (always has at least sorting)
    return filters;
  }, [search, stageFilter, statusFilter, dateRange, sortBy, sortOrder]);

  // T029: Track filter changes to reset pagination synchronously
  // This prevents 416 errors when filters change while on a high page number
  const filterKey = `${search}-${stageFilter}-${statusFilter}-${dateRange.start}-${dateRange.end}`;
  const prevFilterKeyRef = React.useRef<string>(filterKey);

  // Reset to first page when filters change (safe: inside effect)
  useEffect(() => {
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey;
      setPagination(prev => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
    }
  }, [filterKey]);

  // T018-T019: Use paginated query instead of getAll
  const {
    data: paginatedData,
    isLoading: contactsLoading,
    isFetching,
    isPlaceholderData,
  } = useContactsPaginated(pagination, serverFilters);

  // T019: Extract contacts and totalCount from paginated response
  const contacts = paginatedData?.data ?? [];
  const totalCount = paginatedData?.totalCount ?? 0;

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // CRUD State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteWithDeals, setDeleteWithDeals] = useState<{ id: string; dealCount: number; deals: Array<{ id: string; title: string }> } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    companyName: '',
    stage: 'INTERESTED' as ContactStage,
  });
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);

  const isLoading = contactsLoading;

  const openCreateModal = () => {
    setEditingContact(null);
    setFormData({ name: '', email: '', phone: '', role: '', companyName: '', stage: ContactStage.INTERESTED });
    setIsModalOpen(true);
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      role: contact.role || '',
      companyName: '',
      stage: (contact.stage as ContactStage) || ContactStage.INTERESTED,
    });
    setIsModalOpen(true);
  };



  const confirmDelete = async () => {
    if (deleteId) {
      // First check if contact has deals
      try {
        const result = await checkHasDealsMutation.mutateAsync(deleteId);

        if (result.hasDeals) {
          // Show confirmation for deleting with deals
          setDeleteWithDeals({ id: deleteId, dealCount: result.dealCount, deals: result.deals });
          setDeleteId(null);
          return;
        }

        // No deals, delete normally
        deleteContactMutation.mutate(
          { id: deleteId },
          {
            onSuccess: () => {
              (addToast || showToast)('Contato excluído com sucesso', 'success');
              setDeleteId(null);
            },
            onError: (error: Error) => {
              (addToast || showToast)(`Erro ao excluir: ${error.message}`, 'error');
            },
          }
        );
      } catch (error) {
        (addToast || showToast)('Erro ao verificar negócios do contato', 'error');
      }
    }
  };

  const confirmDeleteWithDeals = () => {
    if (deleteWithDeals) {
      deleteContactMutation.mutate(
        { id: deleteWithDeals.id, forceDeleteDeals: true },
        {
          onSuccess: () => {
            (addToast || showToast)(`Contato e ${deleteWithDeals.dealCount} negócio(s) excluídos`, 'success');
            setDeleteWithDeals(null);
          },
          onError: (error: Error) => {
            (addToast || showToast)(`Erro ao excluir: ${error.message}`, 'error');
          },
        }
      );
    }
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const ids = filteredContacts.map(c => c.id);
    if (selectedIds.size === ids.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Bulk delete
  const confirmBulkDelete = async () => {
    const ids: string[] = Array.from(selectedIds);
    let successCount = 0;
    let errorCount = 0;

    try {
      const result = await bulkDeleteContactsMutation.mutateAsync({
        ids,
        forceDeleteDeals: true,
        concurrency: 3,
      });
      successCount = result.successCount;
      errorCount = result.errorCount;
    } catch {
      // If bulk fails unexpectedly, count everything as error (keeps UX predictable)
      errorCount = ids.length;
    }

    if (successCount > 0) {
      (addToast || showToast)(
        `${successCount} contato(s) excluído(s)`,
        'success'
      );
    }
    if (errorCount > 0) {
      (addToast || showToast)(
        `Falha ao excluir ${errorCount} contato(s)`,
        'error'
      );
    }

    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsSubmittingContact(true);
    const normalizedPhone = normalizePhoneE164(formData.phone);

    if (!editingContact) {
      setIsModalOpen(false);
      (addToast || showToast)('Criando contato...', 'info');
    }

    if (editingContact) {
      updateContactMutation.mutate(
        {
          id: editingContact.id,
          updates: {
            name: formData.name,
            email: formData.email,
            phone: normalizedPhone,
            role: formData.role,
            stage: formData.stage,
          },
        },
        {
          onSuccess: () => {
            (addToast || showToast)('Contato atualizado!', 'success');
            setIsModalOpen(false);
          },
          onSettled: () => setIsSubmittingContact(false),
        }
      );
    } else {
      createContactMutation.mutate(
        {
          name: formData.name,
          email: formData.email,
          phone: normalizedPhone,
          role: formData.role,
          companyId: '',
          status: 'ACTIVE',
          stage: formData.stage,
          totalValue: 0,
        },
        {
          onSuccess: () => {
            (addToast || showToast)('Contato criado!', 'success');
          },
          onError: (error: Error) => {
            (addToast || showToast)(`Erro ao criar contato: ${error.message}`, 'error');
            // Re-open modal so user can adjust and retry
            setIsModalOpen(true);
          },
          onSettled: () => setIsSubmittingContact(false),
        }
      );
    }
  };

  const createFakeContactsBatch = useCallback(async (count: number) => {
    const fakeContacts = generateFakeContacts(count);
    let createdCount = 0;

    for (const fake of fakeContacts) {
      await createContactMutation.mutateAsync({
        name: fake.name,
        email: fake.email,
        phone: normalizePhoneE164(fake.phone),
        role: fake.role,
        companyId: '',
        status: 'ACTIVE',
        stage: 'INTERESTED',
        totalValue: 0,
      });

      createdCount++;
    }

    (addToast || showToast)(`${createdCount} contatos fake criados!`, 'success');
  }, [addToast, showToast, createContactMutation]);



  // Update contact wrapper
  const updateContact = (contactId: string, data: Partial<Contact>) => {
    updateContactMutation.mutate({
      id: contactId,
      updates: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
        status: data.status,
        stage: data.stage,
      },
    });
  };

  // T030: Removed client-side filtering - now using server-side filters
  // contacts already comes filtered from the server
  const filteredContacts = contacts;



  // T031: Stage counts from server (RPC)
  // Uses dedicated query for accurate totals across all contacts
  const { data: serverStageCounts = {} } = useContactStageCounts();

  const stageCounts = useMemo(
    () => ({
      INTERESTED: (serverStageCounts.LEAD || 0) + (serverStageCounts.MQL || 0) + (serverStageCounts.PROSPECT || 0) + (serverStageCounts.INTERESTED || 0),
      CUSTOMER: serverStageCounts.CUSTOMER || 0,
      OTHER: (serverStageCounts.CHURNED || 0) + (serverStageCounts.OTHER || 0),
    }),
    [serverStageCounts]
  );

  return {
    // State
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    stageFilter,
    setStageFilter,
    stageCounts,
    viewMode,
    setViewMode,
    isFilterOpen,
    setIsFilterOpen,
    dateRange,
    setDateRange,
    isModalOpen,
    setIsModalOpen,
    editingContact,
    deleteId,
    setDeleteId,
    deleteWithDeals,
    setDeleteWithDeals,
    bulkDeleteConfirm,
    setBulkDeleteConfirm,
    formData,
    setFormData,
    isSubmittingContact,
    isLoading,

    // T017-T020: Pagination state and handlers
    pagination,
    setPagination,
    totalCount,
    isFetching,
    isPlaceholderData,

    // Selection
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,

    // Sorting
    sortBy,
    sortOrder,
    handleSort,

    // Data
    contacts,
    filteredContacts,

    // Actions
    openCreateModal,
    openEditModal,
    confirmDelete,
    confirmDeleteWithDeals,
    handleSubmit,
    createFakeContactsBatch,
    updateContact,
    confirmBulkDelete,
    addToast: addToast || showToast,
  };
};

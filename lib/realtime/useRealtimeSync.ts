/**
 * Supabase Realtime Sync Hook
 *
 * Provides real-time synchronization for multi-user scenarios.
 * When one user makes changes, all other users see updates instantly.
 *
 * Usage:
 *   useRealtimeSync('deals');  // Subscribe to deals table changes
 *   useRealtimeSync(['deals', 'activities']);  // Multiple tables
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/queryKeys';

// Enable detailed Realtime logging in development or when DEBUG_REALTIME env var is set
const DEBUG_REALTIME = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_REALTIME === 'true';

// Tables that support realtime sync
type RealtimeTable =
  | 'deals'
  | 'contacts'
  | 'activities'
  | 'boards'
  | 'board_stages'
  | 'crm_companies';

// Lazy getter for query keys mapping - avoids initialization issues in tests
const getTableQueryKeys = (table: RealtimeTable): readonly (readonly unknown[])[] => {
  const mapping: Record<RealtimeTable, readonly (readonly unknown[])[]> = {
    deals: [queryKeys.deals.all, queryKeys.dashboard.stats],
    contacts: [queryKeys.contacts.all],
    activities: [queryKeys.activities.all],
    boards: [queryKeys.boards.all],
    board_stages: [queryKeys.boards.all], // stages invalidate boards
    crm_companies: [queryKeys.companies.all],
  };
  return mapping[table];
};

interface UseRealtimeSyncOptions {
  /** Whether sync is enabled (default: true) */
  enabled?: boolean;
  /** Debounce invalidation to avoid rapid updates (ms) */
  debounceMs?: number;
  /** Callback when a change is received */
  onchange?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

/**
 * Subscribe to realtime changes on one or more tables
 */
export function useRealtimeSync(
  tables: RealtimeTable | RealtimeTable[],
  options: UseRealtimeSyncOptions = {}
) {
  const { enabled = true, debounceMs = 100, onchange } = options;
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvalidationsRef = useRef<Set<readonly unknown[]>>(new Set());
  const onchangeRef = useRef(onchange);
  
  // Keep callback ref up to date without causing re-renders
  useEffect(() => {
    onchangeRef.current = onchange;
  }, [onchange]);

  useEffect(() => {
    if (!enabled) return;

    const sb = supabase;
    if (!sb) {
      console.warn('[Realtime] Supabase client not available');
      return;
    }

    const tableList = Array.isArray(tables) ? tables : [tables];
    const channelName = `realtime-sync-${tableList.join('-')}`;

    // Cleanup existing channel if any
    if (channelRef.current) {
      if (DEBUG_REALTIME) {
        console.log(`[Realtime] Cleaning up existing channel: ${channelName}`);
      }
      sb.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Create channel
    // Note: Supabase Realtime handles reconnection automatically
    const channel = sb.channel(channelName);

    // Subscribe to each table
    tableList.forEach(table => {
      channel.on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (DEBUG_REALTIME) {
            console.log(`[Realtime] ${table} ${payload.eventType}:`, payload);
          }

          // Call custom callback if provided
          onchangeRef.current?.(payload);

          // Queue query keys for invalidation (lazy loaded)
          const keys = getTableQueryKeys(table);
          keys.forEach(key => pendingInvalidationsRef.current.add(key));

          // For INSERT events, refetch immediately (no debounce) for instant UI updates
          // For UPDATE/DELETE, use debounce to batch multiple rapid changes
          if (payload.eventType === 'INSERT') {
            // Clear any pending debounce
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = null;
            }
            
            // Invalidate and refetch immediately for INSERTs
            // According to TanStack Query v5 docs:
            // - invalidateQueries() marks queries as stale but doesn't force immediate refetch
            // - refetchQueries() forces immediate refetch of matching queries
            // - We use both to ensure: 1) mark as stale, 2) force immediate refetch
            pendingInvalidationsRef.current.forEach(queryKey => {
              if (DEBUG_REALTIME) {
                console.log(`[Realtime] Invalidating and refetching queries immediately for INSERT:`, queryKey);
                
                // Check if there are any queries in cache matching this key
                const cache = queryClient.getQueryCache();
                const matchingQueries = cache.findAll({ queryKey, exact: false });
                console.log(`[Realtime] Found ${matchingQueries.length} queries in cache for key:`, queryKey);
                
                // Log query states for debugging
                matchingQueries.forEach((query, idx) => {
                  console.log(`[Realtime] Query ${idx + 1}:`, {
                    queryKey: query.queryKey,
                    state: query.state.status,
                    isStale: query.isStale(),
                  });
                });
              }
              
              // Step 1: Invalidate and force refetch of all matching queries
              // According to TanStack Query v5 docs:
              // - invalidateQueries with refetchType: 'all' marks as stale AND refetches all matching queries
              // - This bypasses staleTime and ensures instant update
              // - exact: false matches all queries that start with this key
              queryClient.invalidateQueries({ 
                queryKey,
                exact: false, // Match all queries that start with this key
                refetchType: 'all', // Force refetch of ALL matching queries (not just active)
              });
              
              // Step 2: Also try refetchQueries as fallback
              // This ensures queries are refetched even if invalidateQueries doesn't work
              const refetchPromise = queryClient.refetchQueries({ 
                queryKey,
                exact: false, // Match all queries that start with this key
                type: 'all', // Refetch all matching queries (not just active)
              });
              
              // Log result for debugging
              if (DEBUG_REALTIME) {
                refetchPromise
                  .then((result) => {
                    // refetchQueries returns a Promise that resolves to an array of query results (TanStack Query v5)
                    const refetchedCount = Array.isArray(result) ? result.length : 0;
                    if (refetchedCount > 0) {
                      console.log(`[Realtime] ✅ Successfully refetched ${refetchedCount} queries for key:`, queryKey);
                    } else {
                      // Note: invalidateQueries with refetchType: 'all' above should have already refetched
                      // This is just a fallback, so no warning needed if it's 0
                      console.log(`[Realtime] ℹ️ Refetch fallback: ${refetchedCount} queries (invalidateQueries should have already handled it)`);
                    }
                  })
                  .catch((err) => {
                    console.error(`[Realtime] ❌ Error refetching queries:`, err);
                  });
              } else {
                // Still catch errors even when not logging
                refetchPromise.catch((err) => {
                  console.error(`[Realtime] ❌ Error refetching queries:`, err);
                });
              }
            });
            pendingInvalidationsRef.current.clear();
          } else {
            // Debounce invalidation for UPDATE/DELETE
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
            }

            debounceTimerRef.current = setTimeout(() => {
              // Invalidate all pending queries
              pendingInvalidationsRef.current.forEach(queryKey => {
                if (DEBUG_REALTIME) {
                  console.log(`[Realtime] Invalidating queries (debounced):`, queryKey);
                }
                queryClient.invalidateQueries({ queryKey });
              });
              pendingInvalidationsRef.current.clear();
            }, debounceMs);
          }
        }
      );
    });

    // Subscribe to channel
    channel.subscribe((status) => {
      if (DEBUG_REALTIME) {
        console.log(`[Realtime] Channel ${channelName} status:`, status);
      }
      setIsConnected(status === 'SUBSCRIBED');
      
      if (status === 'SUBSCRIBED') {
        if (DEBUG_REALTIME) {
          console.log(`[Realtime] Successfully subscribed to ${tableList.join(', ')}`);
        }
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Realtime] Channel error for ${channelName}`);
      } else if (status === 'TIMED_OUT') {
        console.warn(`[Realtime] Channel timeout for ${channelName}`);
      } else if (status === 'CLOSED') {
        if (DEBUG_REALTIME) {
          console.warn(`[Realtime] Channel closed for ${channelName}`);
        }
      }
    });

    channelRef.current = channel;

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (channelRef.current) {
        sb.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setIsConnected(false);
    };
    // Only re-run if enabled, tables, or debounceMs change
    // queryClient is stable, onchange is handled via ref
  }, [enabled, JSON.stringify(tables), debounceMs]);

  return {
    /** Manually trigger a sync */
    sync: () => {
      const tableList = Array.isArray(tables) ? tables : [tables];
      tableList.forEach(table => {
        const keys = getTableQueryKeys(table);
        keys.forEach(queryKey => {
          queryClient.invalidateQueries({ queryKey });
        });
      });
    },
    /** Check if channel is connected */
    isConnected,
  };
}

/**
 * Subscribe to all CRM-related tables at once
 * Ideal for the main app layout
 */
export function useRealtimeSyncAll(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['deals', 'contacts', 'activities', 'boards', 'crm_companies'], options);
}

/**
 * Subscribe to Kanban-related tables
 * Optimized for the boards page
 */
export function useRealtimeSyncKanban(options: UseRealtimeSyncOptions = {}) {
  return useRealtimeSync(['deals', 'board_stages'], options);
}

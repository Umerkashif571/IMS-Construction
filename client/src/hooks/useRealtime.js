import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

function useDebouncedCallback(callback, delay = 300) {
  const timeoutRef = useRef(null)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args)
    }, delay)
  }, [delay])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return debouncedCallback
}

function createRealtimeHook(subscribeFn) {
  return function useRealtime(onChange, options = {}) {
    const { debounceMs = 300 } = options
    const callbackRef = useRef(onChange)
    callbackRef.current = onChange

    const debouncedOnChange = useDebouncedCallback((payload) => {
      callbackRef.current(payload)
    }, debounceMs)

    useEffect(() => {
      const unsubscribe = subscribeFn((payload) => {
        debouncedOnChange(payload)
      })
      return unsubscribe
    }, [debouncedOnChange])
  }
}

export const useRealtimeStockMovements = createRealtimeHook((callback) =>
  supabase
    .channel('realtime:stock_movements')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, callback)
    .subscribe()
)

export const useRealtimeMaterials = createRealtimeHook((callback) =>
  supabase
    .channel('realtime:materials')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, callback)
    .subscribe()
)

export const useRealtimeMaterialTransactions = createRealtimeHook((callback) =>
  supabase
    .channel('realtime:material_transactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transactions' }, callback)
    .subscribe()
)

export const useRealtimeGatePasses = createRealtimeHook((callback) =>
  supabase
    .channel('realtime:gate_passes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_passes' }, callback)
    .subscribe()
)

export const useRealtimePurchaseOrders = createRealtimeHook((callback) =>
  supabase
    .channel('realtime:purchase_orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, callback)
    .subscribe()
)

export function useRealtimeNotifications(userId, onChange, options = {}) {
  const { debounceMs = 300 } = options
  const callbackRef = useRef(onChange)
  callbackRef.current = onChange

  const debouncedOnChange = useDebouncedCallback((payload) => {
    callbackRef.current(payload)
  }, debounceMs)

  useEffect(() => {
    if (!userId) return
    const channel = supabase.channel(`realtime:notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => debouncedOnChange(payload)
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [userId, debouncedOnChange])
}

function createRealtimeSubscription(subscribeFn) {
  return function subscribe(onChange, options = {}) {
    const { debounceMs = 300 } = options
    const callbackRef = { current: onChange }
    callbackRef.current = onChange

    let timeoutRef = null

    const debouncedOnChange = (payload) => {
      if (timeoutRef) clearTimeout(timeoutRef)
      timeoutRef = setTimeout(() => {
        callbackRef.current(payload)
      }, debounceMs)
    }

    const unsubscribe = subscribeFn((payload) => {
      debouncedOnChange(payload)
    })

    return () => {
      if (timeoutRef) clearTimeout(timeoutRef)
      unsubscribe()
    }
  }
}

export const subscribeToStockMovementsRealtime = createRealtimeSubscription((callback) =>
  supabase
    .channel('realtime:stock_movements')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, callback)
    .subscribe()
)

export const subscribeToMaterialsRealtime = createRealtimeSubscription((callback) =>
  supabase
    .channel('realtime:materials')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, callback)
    .subscribe()
)

export const subscribeToMaterialTransactionsRealtime = createRealtimeSubscription((callback) =>
  supabase
    .channel('realtime:material_transactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'material_transactions' }, callback)
    .subscribe()
)

export const subscribeToGatePassesRealtime = createRealtimeSubscription((callback) =>
  supabase
    .channel('realtime:gate_passes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gate_passes' }, callback)
    .subscribe()
)

export const subscribeToPurchaseOrdersRealtime = createRealtimeSubscription((callback) =>
  supabase
    .channel('realtime:purchase_orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, callback)
    .subscribe()
)

export const subscribeToNotificationsRealtime = createRealtimeSubscription((userId, callback) => {
  if (!userId) return () => {}
  return supabase
    .channel(`realtime:notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      callback
    )
    .subscribe()
})

export function useSupabaseChannel(channelName, config) {
  const channelRef = useRef(null)

  useEffect(() => {
    channelRef.current = supabase.channel(channelName, config)

    channelRef.current.subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [channelName])

  return channelRef.current
}

export function useCoalescedRealtime(subscriptions, onChange, options = {}) {
  const { debounceMs = 300 } = options
  const callbackRef = useRef(onChange)
  callbackRef.current = onChange

  const pendingRef = useRef(new Set())
  const timeoutRef = useRef(null)

  const flush = useCallback(() => {
    if (pendingRef.current.size > 0) {
      const payloads = Array.from(pendingRef.current)
      pendingRef.current.clear()
      callbackRef.current(payloads)
    }
  }, [])

  const debouncedFlush = useDebouncedCallback(flush, debounceMs)

  useEffect(() => {
    const unsubscribes = subscriptions.map((sub) => {
      const { table, event = '*', schema = 'public', filter } = sub
      const channel = supabase.channel(`coalesced:${table}:${Math.random().toString(36).slice(2)}`)

      const handlePayload = (payload) => {
        if (!filter || filter(payload)) {
          pendingRef.current.add(JSON.stringify(payload))
          debouncedFlush()
        }
      }

      channel.on('postgres_changes', { event, schema, table, ...(filter ? { filter } : {}) }, handlePayload).subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    })

    return () => {
      unsubscribes.forEach(unsub => unsub())
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [subscriptions, debouncedFlush])
}
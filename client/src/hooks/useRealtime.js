import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

function useDebouncedCallback(callback, delay = 300) {
  const timeoutRef = useRef(null)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const debouncedCallback = useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      try {
        const fn = callbackRef.current
        if (typeof fn === 'function') fn(...args)
      } catch (e) {
        console.error('Debounced callback error:', e)
      }
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
      try {
        const fn = callbackRef.current
        if (typeof fn === 'function') fn(payload)
      } catch (e) {
        console.error('Realtime callback error:', e)
      }
    }, debounceMs)

    useEffect(() => {
      // subscribeFn returns the RealtimeChannel from .subscribe(); React needs a
      // cleanup *function*, otherwise it throws "x is not a function" on unmount.
      const channel = subscribeFn((payload) => {
        debouncedOnChange(payload)
      })
      return () => {
        if (channel) {
          try { supabase.removeChannel(channel) } catch (e) { console.error('Failed to remove realtime channel:', e) }
        }
      }
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
    try {
      const fn = callbackRef.current
      if (typeof fn === 'function') fn(payload)
    } catch (e) {
      console.error('Realtime notification callback error:', e)
    }
  }, debounceMs)

  useEffect(() => {
    if (!userId) return
    let channel = null
    try {
      channel = supabase.channel(`realtime:notifications:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => debouncedOnChange(payload)
        )
        .subscribe()
    } catch (e) {
      console.error('Failed to subscribe to notifications:', e)
    }
    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch (e) {
          console.error('Failed to remove notification channel:', e)
        }
      }
    }
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
        try {
          const fn = callbackRef.current
          if (typeof fn === 'function') fn(payload)
        } catch (e) {
          console.error('Realtime subscription callback error:', e)
        }
      }, debounceMs)
    }

    const channel = subscribeFn((payload) => {
      debouncedOnChange(payload)
    })

    return () => {
      if (timeoutRef) clearTimeout(timeoutRef)
      if (channel) {
        try { supabase.removeChannel(channel) } catch (e) { console.error('Failed to remove realtime channel:', e) }
      }
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
    if (!channelName) return
    let channel = null
    try {
      const cfg = (config && typeof config === 'object') ? config : {}
      channel = supabase.channel(channelName, cfg)
      channel.subscribe()
      channelRef.current = channel
    } catch (e) {
      console.error('Failed to create supabase channel:', e)
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch (e) {
          console.error('Failed to remove supabase channel:', e)
        }
      }
    }
  }, [channelName, config])

  return channelRef.current
}

export function useCoalescedRealtime(subscriptions, onChange, options = {}) {
  const { debounceMs = 300 } = options
  const callbackRef = useRef(onChange)
  callbackRef.current = onChange

  const pendingRef = useRef(new Set())
  const timeoutRef = useRef(null)

  const flush = useCallback(() => {
    try {
      if (pendingRef.current.size > 0) {
        const payloads = Array.from(pendingRef.current)
        pendingRef.current.clear()
        const fn = callbackRef.current
        if (typeof fn === 'function') fn(payloads)
      }
    } catch (e) {
      console.error('Coalesced realtime flush error:', e)
    }
  }, [])

  const debouncedFlush = useDebouncedCallback(flush, debounceMs)

  useEffect(() => {
    if (!Array.isArray(subscriptions) || !subscriptions.length) return
    const unsubscribes = subscriptions.map((sub) => {
      if (!sub || !sub.table) return () => {}
      const { table, event = '*', schema = 'public', filter } = sub
      let channel = null
      try {
        channel = supabase.channel(`coalesced:${table}:${Math.random().toString(36).slice(2)}`)

        const handlePayload = (payload) => {
          try {
            if (!filter || filter(payload)) {
              pendingRef.current.add(JSON.stringify(payload))
              debouncedFlush()
            }
          } catch (e) {
            console.error('Coalesced realtime payload error:', e)
          }
        }

        channel.on('postgres_changes', { event, schema, table, ...(filter ? { filter } : {}) }, handlePayload).subscribe()
      } catch (e) {
        console.error('Failed to subscribe to coalesced realtime:', e)
      }

      return () => {
        if (channel) {
          try {
            supabase.removeChannel(channel)
          } catch (e) {
            console.error('Failed to remove coalesced channel:', e)
          }
        }
      }
    })

    return () => {
      try {
        if (Array.isArray(unsubscribes)) {
          unsubscribes.forEach(unsub => {
            try { typeof unsub === 'function' && unsub() } catch (e) { console.error('Unsubscribe error:', e) }
          })
        }
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
      } catch (e) {
        console.error('Coalesced realtime cleanup error:', e)
      }
    }
  }, [subscriptions, debouncedFlush])
}
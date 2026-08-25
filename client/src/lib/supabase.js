import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://djaxnbusmvdukkkfbgbe.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable__kZyUctOA0k2I2MgOnmgUA_ymqDKtws'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

export const subscribeToTable = (table, callback, filter = {}) => {
  const channel = supabase
    .channel(`realtime:${table}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        ...filter,
      },
      (payload) => callback(payload)
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export const subscribeToStockMovements = (callback) => {
  return subscribeToTable('stock_movements', callback)
}

export const subscribeToMaterials = (callback) => {
  return subscribeToTable('materials', callback)
}

export const subscribeToMaterialTransactions = (callback) => {
  return subscribeToTable('material_transactions', callback)
}

export const subscribeToGatePasses = (callback) => {
  return subscribeToTable('gate_passes', callback)
}

export const subscribeToPurchaseOrders = (callback) => {
  return subscribeToTable('purchase_orders', callback)
}

export const subscribeToNotifications = (userId, callback) => {
  const channel = supabase
    .channel(`realtime:notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => callback(payload)
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
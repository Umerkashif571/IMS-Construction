import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api'

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const cache = {
  categories: { data: null, timestamp: 0, promise: null },
  projects: { data: null, timestamp: 0, promise: null },
  warehouses: { data: null, timestamp: 0, promise: null },
  vendors: { data: null, timestamp: 0, promise: null },
}

function isStale(key) {
  const entry = cache[key]
  return !entry.data || Date.now() - entry.timestamp > CACHE_TTL
}

async function fetchWithCache(key, fetchFn) {
  const entry = cache[key]

  if (!isStale(key)) {
    return entry.data
  }

  if (entry.promise) {
    return entry.promise
  }

  entry.promise = fetchFn().then(data => {
    entry.data = data
    entry.timestamp = Date.now()
    entry.promise = null
    return data
  }).catch(err => {
    entry.promise = null
    throw err
  })

  return entry.promise
}

export function useCategories() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchWithCache('categories', () =>
        api.get('/materials/categories/list').then(r => r.data)
      )
      setData(Array.isArray(result) ? result : [])
      setError(null)
    } catch (err) {
      console.warn('Categories load failed:', err?.message || err)
      setData([])
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const invalidate = useCallback(() => {
    cache.categories = { data: null, timestamp: 0, promise: null }
    load()
  }, [load])

  return { data, loading, error, invalidate }
}

export function useProjects(params = {}) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pagination, setPagination] = useState(null)
  const paramsRef = useRef(params)

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams(paramsRef.current).toString()
      const url = query ? `/projects?${query}` : '/projects'
      const result = await api.get(url)
      setData(Array.isArray(result?.data?.data) ? result.data.data : (Array.isArray(result?.data) ? result.data : []))
      setPagination(result.data?.pagination || null)
      setError(null)
    } catch (err) {
      console.warn('Projects load failed:', err?.message || err)
      setData([])
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    paramsRef.current = params
    load()
  }, [load, params])

  const invalidate = useCallback(() => {
    cache.projects = { data: null, timestamp: 0, promise: null }
    load()
  }, [load])

  return { data, loading, error, pagination, invalidate }
}

export function useWarehouses() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchWithCache('warehouses', () =>
        api.get('/warehouses').then(r => r.data)
      )
      setData(Array.isArray(result) ? result : [])
      setError(null)
    } catch (err) {
      console.warn('Warehouses load failed:', err?.message || err)
      setData([])
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const invalidate = useCallback(() => {
    cache.warehouses = { data: null, timestamp: 0, promise: null }
    load()
  }, [load])

  return { data, loading, error, invalidate }
}

export function useVendors() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchWithCache('vendors', () =>
        api.get('/vendors').then(r => r.data)
      )
      setData(Array.isArray(result) ? result : [])
      setError(null)
    } catch (err) {
      console.warn('Vendors load failed:', err?.message || err)
      setData([])
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const invalidate = useCallback(() => {
    cache.vendors = { data: null, timestamp: 0, promise: null }
    load()
  }, [load])

  return { data, loading, error, invalidate }
}

export function invalidateAllReferenceData() {
  Object.keys(cache).forEach(key => {
    cache[key] = { data: null, timestamp: 0, promise: null }
  })
}
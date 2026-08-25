import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' })

const pendingRequests = new Map()
const cache = new Map()
const CACHE_TTL = 30000

let isRefreshing = false

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ims_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      if (window.location.pathname !== '/login' && !isRefreshing) {
        localStorage.removeItem('ims_token')
        localStorage.removeItem('ims_user')
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

function getCacheKey(config) {
  return `${config.method?.toUpperCase()}:${config.url}:${JSON.stringify(config.params)}:${JSON.stringify(config.data)}`
}

function isCacheable(config) {
  return config.method?.toLowerCase() === 'get'
}

async function deduplicatedRequest(config) {
  const key = getCacheKey(config)

  if (isCacheable(config)) {
    const cached = cache.get(key)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return Promise.resolve({ ...cached.response, fromCache: true })
    }
  }

  const existing = pendingRequests.get(key)
  if (existing) {
    return existing
  }

  const promise = api.request(config).then((response) => {
    if (isCacheable(config)) {
      cache.set(key, { response, timestamp: Date.now() })
    }
    pendingRequests.delete(key)
    return response
  }).catch((err) => {
    pendingRequests.delete(key)
    throw err
  })

  pendingRequests.set(key, promise)
  return promise
}

export function clearCache(pattern) {
  if (!pattern) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key)
  }
}

export function invalidateCache(pattern) {
  clearCache(pattern)
}

api.request = deduplicatedRequest

export async function downloadFile(path, fallbackFilename) {
  const res = await api.get(path, { responseType: 'blob' })
  const blob = res.data
  let filename = fallbackFilename
  const cd = res.headers['content-disposition']
  if (cd) {
    const m = cd.match(/filename="?([^";]+)"?/)
    if (m) filename = m[1]
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default api
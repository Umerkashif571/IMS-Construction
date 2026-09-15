import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' })

// Request deduplication: prevent identical simultaneous GET requests
const pendingRequests = new Map()

function getCacheKey(config) {
  return `${config.method?.toUpperCase() || 'GET'}:${config.url}:${JSON.stringify(config.params)}`
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ims_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  if (config.method?.toLowerCase() !== 'get') return config
  const key = getCacheKey(config)
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key).then(response => {
      throw { __deduped: true, response }
    })
  }
  const promise = new Promise((resolve) => {
    config.adapter = async (cfg) => {
      try {
        const response = await axios.defaults.adapter(cfg)
        resolve(response)
        return response
      } catch (err) {
        resolve(Promise.reject(err))
        throw err
      }
    }
  })
  pendingRequests.set(key, promise)
  return config
})

api.interceptors.response.use(
  (res) => {
    const key = getCacheKey(res.config)
    pendingRequests.delete(key)
    return res
  },
  (err) => {
    if (err.__deduped) return err.response
    const key = getCacheKey(err.config)
    pendingRequests.delete(key)
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('ims_token')
      localStorage.removeItem('ims_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export function errorMessage(err, fallback = 'Something went wrong') {
  if (!err) return fallback
  if (!err.response) return 'Cannot reach the server. Check your connection.'
  return err.response.data?.error || err.response.data?.message || fallback
}

export async function downloadFile(path, fallbackFilename) {
  const res = await api.get(path, { responseType: 'blob' })
  const blob = res.data
  let filename = fallbackFilename
  const cd = res.headers['content-disposition']
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8\'\')?"?([^";]+)"?/i)
    if (m) filename = decodeURIComponent(m[1])
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
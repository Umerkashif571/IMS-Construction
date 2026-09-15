import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ims_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
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
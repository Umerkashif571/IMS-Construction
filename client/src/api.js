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
    if (err.response?.status === 401) {
      localStorage.removeItem('ims_token')
      localStorage.removeItem('ims_user')
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Download a file with the auth header (anchor tags bypass the axios interceptor)
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
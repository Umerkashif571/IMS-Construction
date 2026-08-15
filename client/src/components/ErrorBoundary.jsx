import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-3">
          <div className="text-sm font-semibold text-red-700">Something went wrong</div>
          <p className="text-xs text-red-600/80 break-words">{(this.state.error && (this.state.error.message || String(this.state.error))) || 'Unknown error'}</p>
          <button
            onClick={() => location.reload()}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface Health {
  status: string
  embedder: string
  llm: string
  store: string
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24, textAlign: 'left' }}>
      <h1>Telecom Ticket Analyzer</h1>
      <h2>Backend health</h2>
      {error && <p style={{ color: 'crimson' }}>Could not reach {API_URL}: {error}</p>}
      {!error && !health && <p>Checking…</p>}
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
    </main>
  )
}

export default App

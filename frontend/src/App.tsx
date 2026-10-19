import { useEffect, useState } from 'react'
import './App.css'
import { analyzeTicket, ApiError, type AnalysisResult } from './api'
import { SimilarTickets } from './components/SimilarTickets'
import { SolutionCard } from './components/SolutionCard'
import { TicketForm } from './components/TicketForm'

function App() {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [similarOpen, setSimilarOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setHighlightedId(null)
    setSimilarOpen(false)
    try {
      setResult(await analyzeTicket(description.trim()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong analyzing this ticket.')
    } finally {
      setLoading(false)
    }
  }

  // Source chip → open the list, then scroll to and highlight that ticket.
  const showSource = (id: string) => {
    setSimilarOpen(true)
    setHighlightedId(id)
  }

  useEffect(() => {
    if (!highlightedId || !similarOpen) return
    document.getElementById(`ticket-${highlightedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setHighlightedId(null), 2500)
    return () => clearTimeout(timer)
  }, [highlightedId, similarOpen])

  return (
    <div className="page">
      <header className="site-header">
        <h1>Telecom Ticket Analyzer</h1>
        <p className="subtitle">Paste a customer ticket — get the top 3 fixes from similar resolved tickets.</p>
      </header>

      <main>
        <TicketForm value={description} loading={loading} onChange={setDescription} onSubmit={handleSubmit} />

        {loading && (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Finding similar tickets and drafting fixes…
          </div>
        )}

        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}

        {result && (
          <section className="results" aria-label="Suggested fixes">
            {result.note && <div className="banner banner-note">{result.note}</div>}
            <h2 className="section-title">Top 3 fixes</h2>
            {[...result.solutions]
              .sort((a, b) => a.rank - b.rank)
              .map((s) => (
                <SolutionCard key={s.rank} solution={s} onSourceClick={showSource} />
              ))}
            <SimilarTickets
              tickets={result.similarTickets}
              open={similarOpen}
              highlightedId={highlightedId}
              onToggle={() => setSimilarOpen((v) => !v)}
            />
          </section>
        )}
      </main>

      {result && (
        <footer className="site-footer">
          embed {result.timings.embedMs} ms · search {result.timings.searchMs} ms · LLM {result.timings.llmMs} ms
        </footer>
      )}
    </div>
  )
}

export default App

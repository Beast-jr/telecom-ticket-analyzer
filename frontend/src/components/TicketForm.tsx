import type { FormEvent } from 'react'

export const MIN_CHARS = 10
export const MAX_CHARS = 2000

const SAMPLES = [
  { label: 'Slow internet', text: 'my internet has been super slow since yesterday, videos keep buffering on my redmi phone in pune' },
  { label: 'Charged twice', text: 'i was charged twice for my 599 recharge this morning please refund' },
  {
    label: 'No network abroad',
    text: "I'm travelling in Dubai and my phone shows no network even though I activated the roaming pack",
  },
]

interface Props {
  value: string
  loading: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}

export function TicketForm({ value, loading, onChange, onSubmit }: Props) {
  const length = value.trim().length
  const valid = length >= MIN_CHARS && length <= MAX_CHARS

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (valid && !loading) onSubmit()
  }

  let hint = `${length} / ${MAX_CHARS}`
  if (length > 0 && length < MIN_CHARS) hint = `${length} / ${MAX_CHARS} · at least ${MIN_CHARS} characters`
  if (length > MAX_CHARS) hint = `${length} / ${MAX_CHARS} · too long`

  return (
    <form className="ticket-form" onSubmit={handleSubmit}>
      <label htmlFor="ticket" className="field-label">
        Customer ticket
      </label>
      <textarea
        id="ticket"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. my 5G stopped showing after the last update, only 4G in Bengaluru…"
        rows={6}
        disabled={loading}
      />
      <div className="form-row">
        <div className="samples" aria-label="Sample tickets">
          <span className="samples-label">Try:</span>
          {SAMPLES.map((s) => (
            <button key={s.label} type="button" className="chip chip-sample" onClick={() => onChange(s.text)} disabled={loading}>
              {s.label}
            </button>
          ))}
        </div>
        <span className={`char-count${length > MAX_CHARS || (length > 0 && !valid) ? ' char-count-bad' : ''}`}>{hint}</span>
      </div>
      <button type="submit" className="btn-primary" disabled={!valid || loading}>
        {loading ? 'Analyzing…' : 'Analyze'}
      </button>
    </form>
  )
}

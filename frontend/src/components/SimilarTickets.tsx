import { useState } from 'react'
import type { SimilarTicket } from '../api'

interface Props {
  tickets: SimilarTicket[]
  open: boolean
  highlightedId: string | null
  onToggle: () => void
}

function TicketItem({ ticket, highlighted }: { ticket: SimilarTicket; highlighted: boolean }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <li id={`ticket-${ticket.id}`} className={`similar-item${highlighted ? ' highlighted' : ''}`}>
      <div className="similar-meta">
        <span className="similar-id">{ticket.id}</span>
        <span className="similar-cat">
          {ticket.category} › {ticket.subtopic}
        </span>
        <span className="similar-sim">{Math.round(ticket.similarity * 100)}% similar</span>
      </div>
      <div className={expanded ? '' : 'clamp'}>
        <p>
          <strong>Problem:</strong> {ticket.description}
        </p>
        <p>
          <strong>Fix:</strong> {ticket.resolution}
        </p>
      </div>
      <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </li>
  )
}

export function SimilarTickets({ tickets, open, highlightedId, onToggle }: Props) {
  return (
    <section className="card similar">
      <button type="button" className="similar-toggle" aria-expanded={open} onClick={onToggle}>
        <span className={`caret${open ? ' caret-open' : ''}`} aria-hidden="true">
          ▸
        </span>
        {tickets.length} similar past tickets
      </button>
      {open && (
        <ul className="similar-list">
          {tickets.map((t) => (
            <TicketItem key={t.id} ticket={t} highlighted={t.id === highlightedId} />
          ))}
        </ul>
      )}
    </section>
  )
}

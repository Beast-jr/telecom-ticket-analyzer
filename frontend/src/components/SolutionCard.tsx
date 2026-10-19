import { useState } from 'react'
import type { Solution } from '../api'

// Steps arrive as one string: "1) Do X 2) Do Y". Split on the step markers.
function splitSteps(steps: string): string[] {
  return steps
    .split(/(?:^|\s+)\d+[.)]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function level(suitability: number) {
  if (suitability >= 75) return 'high'
  if (suitability >= 50) return 'mid'
  return 'low'
}

interface Props {
  solution: Solution
  onSourceClick: (id: string) => void
}

export function SolutionCard({ solution, onSourceClick }: Props) {
  const [showWhy, setShowWhy] = useState(false)
  const { rank, title, steps, suitability, llmScore, avgSim, evidenceBonus, sourceTicketIds } = solution
  const evidence = Math.round(avgSim * 100)

  return (
    <article className={`card solution level-${level(suitability)}`}>
      <header className="solution-head">
        <span className="rank-badge" aria-label={`Rank ${rank}`}>
          {rank}
        </span>
        <h3 className="solution-title">{title}</h3>
        <div className="score">
          <span className="score-value">{suitability}%</span>
          <span className="score-label">suitability</span>
        </div>
      </header>

      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={suitability}>
        <div className="bar-fill" style={{ width: `${suitability}%` }} />
      </div>

      <ol className="steps">
        {splitSteps(steps).map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <footer className="solution-foot">
        <div className="sources">
          <span className="sources-label">Based on</span>
          {sourceTicketIds.map((id) => (
            <button key={id} type="button" className="chip chip-source" onClick={() => onSourceClick(id)}>
              {id}
            </button>
          ))}
        </div>
        <button type="button" className="link-btn" aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)}>
          Why this %?
        </button>
      </footer>
      {showWhy && (
        <p className="why">
          LLM fit {llmScore} × 0.6 + evidence {evidence} × 0.4 + bonus {evidenceBonus} = {suitability}%
        </p>
      )}
    </article>
  )
}

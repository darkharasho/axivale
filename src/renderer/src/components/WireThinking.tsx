import { useEffect, useState, type ReactElement } from 'react'

const PHRASES = [
  'consulting the wire',
  'interviewing sources',
  'checking the ledger',
  'setting type',
  'proofing the galley',
  'inking the press'
]

/** Telegraph-style "story incoming" indicator shown before any text arrives. */
export default function WireThinking(): ReactElement {
  const [phrase, setPhrase] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 1800)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="wire">
      <div className="wline">
        <span className="wsig">
          <span className="dot"></span>
          <span className="dash"></span>
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dash"></span>
        </span>
        <span className="wmsg">Receiving wire — {PHRASES[phrase]}…</span>
      </div>
      <div className="wskel">
        <div className="wbar" style={{ width: '62%' }}></div>
        <div className="wbar" style={{ width: '96%' }}></div>
        <div className="wbar" style={{ width: '91%' }}></div>
        <div className="wbar" style={{ width: '78%' }}></div>
      </div>
    </div>
  )
}

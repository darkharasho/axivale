import type { ReactElement } from 'react'
import type { DisplayPayload } from '../../state'

type PositioningPayload = Extract<DisplayPayload, { kind: 'positioning' }>

// Fixed canvas dimensions (SVG panels sized explicitly — no ResponsiveContainer needed)
const MAP_W = 280
const MAP_H = 280
const STRIP_W = 260
const STRIP_H = 100
const STRIP_PAD = { top: 12, right: 12, bottom: 20, left: 36 }

// Newsprint palette (matches CSS variables used by the rest of the app)
const ACCENT = '#e05a50' // --accent / red (commander path)
const ACCENT_B = '#6fae6f' // --accent-b / green (squad mass)
const AMBER = '#c8984a' // --amber (downs)
const FAINT = 'rgba(255,255,255,0.08)' // --faint
const DEATH_COLOR = 'rgba(224, 90, 80, 0.45)' // semi-transparent red for death hotspots
const DOWN_COLOR = AMBER
const MONO = "'IBM Plex Mono', monospace"
const SERIF = "'Playfair Display', Georgia, serif"

/** Scale a single [x, y] map-space point into the SVG viewBox. */
function scalePoint(
  x: number,
  y: number,
  mapW: number,
  mapH: number,
  svgW: number,
  svgH: number,
  pad: number = 8
): [number, number] {
  const usableW = svgW - pad * 2
  const usableH = svgH - pad * 2
  return [pad + (x / mapW) * usableW, pad + (y / mapH) * usableH]
}

function MapPanel({ data }: { data: PositioningPayload }): ReactElement {
  const [mapW, mapH] = data.map.sizes
  const pad = 8

  const scale = (x: number, y: number): [number, number] =>
    scalePoint(x, y, mapW, mapH, MAP_W, MAP_H, pad)

  // Tag path polyline points string
  const pathPoints = data.tagPath.map(([x, y]) => scale(x, y).join(',')).join(' ')

  // Squad mass ellipse — scale radius proportionally (use smaller axis ratio)
  const scaleRatio = (MAP_W - pad * 2) / mapW
  const scaledR = data.squadMass.r * scaleRatio
  const [massX, massY] = scale(data.squadMass.x, data.squadMass.y)

  return (
    <svg
      width={MAP_W}
      height={MAP_H}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      aria-label="Commander positioning map"
    >
      {/* Background */}
      <rect width={MAP_W} height={MAP_H} fill="#1a1c20" rx={2} />
      <rect
        x={pad}
        y={pad}
        width={MAP_W - pad * 2}
        height={MAP_H - pad * 2}
        fill="#1f2025"
        stroke="#2e3036"
        strokeWidth={1}
      />

      {/* Squad mass bounding ellipse */}
      <ellipse
        cx={massX}
        cy={massY}
        rx={scaledR}
        ry={scaledR}
        fill={FAINT}
        stroke={ACCENT_B}
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.7}
      />

      {/* Death dots — semi-transparent red; overlapping points form hotspots */}
      {data.deaths.map(([x, y], i) => {
        const [sx, sy] = scale(x, y)
        return <circle key={i} cx={sx} cy={sy} r={5} fill={DEATH_COLOR} />
      })}

      {/* Down dots — small amber */}
      {data.downs.map(([x, y], i) => {
        const [sx, sy] = scale(x, y)
        return <circle key={i} cx={sx} cy={sy} r={3} fill={DOWN_COLOR} opacity={0.85} />
      })}

      {/* Commander tag path polyline */}
      {data.tagPath.length > 1 && (
        <polyline
          points={pathPoints}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Start/end markers on path */}
      {data.tagPath.length > 0 && (() => {
        const [sx, sy] = scale(data.tagPath[0][0], data.tagPath[0][1])
        return <circle cx={sx} cy={sy} r={3} fill={ACCENT} opacity={0.9} />
      })()}
      {data.tagPath.length > 1 && (() => {
        const last = data.tagPath[data.tagPath.length - 1]
        const [sx, sy] = scale(last[0], last[1])
        return <circle cx={sx} cy={sy} r={4} fill={ACCENT} stroke="#1f2025" strokeWidth={1} />
      })()}
    </svg>
  )
}

function SpreadStrip({ data }: { data: PositioningPayload }): ReactElement {
  const { top, right, bottom, left } = STRIP_PAD
  const plotW = STRIP_W - left - right
  const plotH = STRIP_H - top - bottom

  const spread = data.spread
  if (spread.length === 0) {
    return (
      <svg width={STRIP_W} height={STRIP_H} viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}>
        <rect width={STRIP_W} height={STRIP_H} fill="#1a1c20" rx={2} />
      </svg>
    )
  }

  const maxSec = Math.max(...spread.map(([s]) => s))
  const maxVal = Math.max(...spread.map(([, v]) => v))
  const minSec = Math.min(...spread.map(([s]) => s))

  const sx = (sec: number): number =>
    left + ((sec - minSec) / (maxSec - minSec || 1)) * plotW
  const sy = (val: number): number =>
    top + plotH - (val / (maxVal || 1)) * plotH

  const linePts = spread.map(([s, v]) => `${sx(s)},${sy(v)}`).join(' ')

  // Peak spread line position
  const peakY = sy(data.peakSpread)
  const peakX = sx(spread.find(([, v]) => v === data.peakSpread)?.[0] ?? maxSec)

  return (
    <svg
      width={STRIP_W}
      height={STRIP_H}
      viewBox={`0 0 ${STRIP_W} ${STRIP_H}`}
      aria-label="Spread over time"
    >
      {/* Background */}
      <rect width={STRIP_W} height={STRIP_H} fill="#1a1c20" rx={2} />
      <rect
        x={left}
        y={top}
        width={plotW}
        height={plotH}
        fill="#1f2025"
        stroke="#2e3036"
        strokeWidth={1}
      />

      {/* Axes */}
      <line x1={left} y1={top + plotH} x2={left + plotW} y2={top + plotH} stroke="#3a3d44" strokeWidth={1} />
      <line x1={left} y1={top} x2={left} y2={top + plotH} stroke="#3a3d44" strokeWidth={1} />

      {/* Y-axis label */}
      <text
        x={left - 4}
        y={top + plotH / 2}
        textAnchor="middle"
        fontSize={7}
        fontFamily={MONO}
        fill="#6a6b6e"
        transform={`rotate(-90, ${left - 4}, ${top + plotH / 2})`}
      >
        spread
      </text>

      {/* Spread polyline */}
      {spread.length > 1 && (
        <polyline
          points={linePts}
          fill="none"
          stroke={ACCENT_B}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}

      {/* Peak threshold dashed line */}
      <line
        x1={left}
        y1={peakY}
        x2={left + plotW}
        y2={peakY}
        stroke={ACCENT}
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.7}
      />

      {/* Peak callout marker */}
      <circle cx={peakX} cy={peakY} r={3} fill={ACCENT} />

      {/* Peak label */}
      <text
        x={Math.min(peakX + 5, left + plotW - 30)}
        y={peakY - 4}
        fontSize={8}
        fontFamily={MONO}
        fill={ACCENT}
      >
        peak {data.peakSpread}
      </text>
    </svg>
  )
}

export default function RichPositioning({ data }: { data: PositioningPayload }): ReactElement {
  if (data.degree !== 'full') {
    return (
      <div className="rich richpositioning richpositioning--partial">
        <p style={{ fontFamily: MONO, fontSize: 11, color: '#6a6b6e', margin: 0 }}>
          no replay trajectories — coarse positioning data only
        </p>
      </div>
    )
  }

  const totalW = MAP_W + 16 + STRIP_W

  return (
    <div className="rich richpositioning">
      {/* Two-panel layout: map | spread strip stacked on the right */}
      <svg
        width={totalW}
        height={MAP_H}
        viewBox={`0 0 ${totalW} ${MAP_H}`}
        role="img"
        aria-label="Positional analysis figure"
      >
        {/* Map panel (left) */}
        <foreignObject x={0} y={0} width={MAP_W} height={MAP_H}>
          <MapPanel data={data} />
        </foreignObject>

        {/* Spread strip (right, vertically centered) */}
        <foreignObject x={MAP_W + 16} y={(MAP_H - STRIP_H) / 2} width={STRIP_W} height={STRIP_H}>
          <SpreadStrip data={data} />
        </foreignObject>
      </svg>

      {/* Caption */}
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 11,
          color: '#9a9b9e',
          marginTop: 6,
          letterSpacing: '0.03em',
          fontStyle: 'italic'
        }}
      >
        Commander path · squad mass · deaths (red) · downs (amber) · peak spread {data.peakSpread} in
      </div>
    </div>
  )
}

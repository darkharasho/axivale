import type { ReactElement } from 'react'
import {
  LineChart,
  BarChart,
  AreaChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts'
import type { DisplayPayload } from '../../state'

type ChartSpec = Extract<DisplayPayload, { kind: 'chart' }>['data']

/** Series fall back to rotating gazette inks when no color is specified. */
const PALETTE = ['#e05a50', '#6fae6f', '#a6a69e', '#c8984a', '#7a9cc6', '#b07ab0']

const MONO = "'IBM Plex Mono', monospace"
const AXIS_TICK = { fill: '#6a6b6e', fontSize: 9, fontFamily: MONO } as const
const TOOLTIP_STYLE = {
  background: '#1f2025',
  border: '1px dashed #46494f',
  borderRadius: 0,
  fontFamily: MONO,
  fontSize: 11,
  color: '#e4e3dc'
} as const

// Fixed canvas: coupons cap at 620px wide; ResponsiveContainer needs a
// measured parent and renders 0×0 in jsdom, so we size explicitly.
const WIDTH = 560
const HEIGHT = 240

export default function RichChart({ spec }: { spec: ChartSpec }): ReactElement {
  const color = (i: number): string => spec.series[i].color ?? PALETTE[i % PALETTE.length]
  const common = {
    data: spec.rows,
    width: WIDTH,
    height: HEIGHT,
    margin: { top: 8, right: 12, bottom: 4, left: 0 }
  }
  const axes = (
    <>
      <CartesianGrid stroke="#2e3036" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={spec.xKey} tick={AXIS_TICK} stroke="#3a3d44" tickLine={false} />
      <YAxis tick={AXIS_TICK} stroke="#3a3d44" tickLine={false} width={36} />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        cursor={{ stroke: '#46494f', fill: 'rgba(255,255,255,.04)' }}
      />
      <Legend
        wrapperStyle={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '.1em',
          textTransform: 'uppercase'
        }}
      />
    </>
  )

  let chart: ReactElement
  if (spec.type === 'bar') {
    chart = (
      <BarChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={color(i)} isAnimationActive={false} />
        ))}
      </BarChart>
    )
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Area
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stroke={color(i)}
            fill={color(i)}
            fillOpacity={0.18}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    )
  } else {
    chart = (
      <LineChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stroke={color(i)}
            strokeWidth={1.5}
            dot={{ r: 2.5, fill: color(i) }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    )
  }

  return (
    <div className="rich richchart">
      <div className="rich-title-bar">
        <div className="rich-title">{spec.title}</div>
        {spec.stale && (
          <span className="rich-stale-badge">cached · {spec.staleAge} · source unreachable</span>
        )}
      </div>
      {chart}
    </div>
  )
}

import type { ReactElement } from 'react'
import type { DisplayPayload } from '../../state'
import RichChart from './RichChart'
import RichTable from './RichTable'
import ForgeCard from './ForgeCard'

/** Returns the rich block for a display payload, or null when this build of
 *  the app has no renderer for the kind (the coupon then shows generic copy). */
export default function RichDisplay({ display }: { display: DisplayPayload }): ReactElement | null {
  switch (display.kind) {
    case 'chart':
      return <RichChart spec={display.data} />
    case 'table':
      return <RichTable spec={display.data} />
    case 'build-card':
    case 'comp-card':
      return <ForgeCard display={display} />
    default:
      return null
  }
}

import type { ReactElement } from 'react'
import type { OperationsSection } from './OperationsNav'
import Builds from './Builds'
import Comps from './Comps'
import Bureau from './Bureau'

/** Operations tab body: shows one of Builds / Compositions / Bureau, picked by
 *  the left-rail OperationsNav. Each child owns its own state, so this is a thin
 *  switch. */
export default function Operations({ active }: { active: OperationsSection }): ReactElement {
  if (active === 'comps') return <Comps />
  if (active === 'bureau') return <Bureau />
  return <Builds />
}

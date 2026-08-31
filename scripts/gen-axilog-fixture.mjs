// Regenerates src/main/__fixtures__/wvw-small.report.json from the committed
// anonymized log. Run it when @axiapps/axilog is upgraded; the worker
// integration test (Task 3) fails if the committed JSON drifts from reality.
//
// Parse passes: { everything: true }. Measured output on the committed
// wvw-small.anon.zevtc fixture is ~2.7 MB, well under the ~10 MB budget for a
// fixture committed to git forever, and `everything: true` is the only way to
// get every block later tasks need (damage, defenses, support, boons, cc, and
// a squad-only minions section) plus catalogs/coverage in one parse pass, so
// there was no reason to hand-pick a narrower option set. See task-2-report.md
// for the full sizing rationale.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { parseFile } = require('@axiapps/axilog')

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'src', 'main', '__fixtures__')
const report = parseFile(join(fixtures, 'wvw-small.anon.zevtc'), { everything: true })
writeFileSync(join(fixtures, 'wvw-small.report.json'), JSON.stringify(report))
console.log('wrote wvw-small.report.json —', report.entities.length, 'entities')

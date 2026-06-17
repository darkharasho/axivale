# Entity Autolinking — Iteration 3 (richer card via AxiForge's fact logic + bigger icon)

> Follow-up on branch feat/entity-autolinking. Subagent-driven, review per task.

**Feedback:** the hover card is too sparse (skills show only Recharge + Activation) and the icon is too small. AxiForge already solved GW2 fact rendering — reuse what we can.

**Design (approved — "copy what we can"):**
- Reuse `@axiapps/gw2-data`'s `Gw2ApiClient.fetchByIds(endpoint, ids)` (already installed) to fetch the full skill/trait object (`description`, `facts[]`, `icon`) by id.
- Port AxiForge's fact→text logic (`formatFactHtml`/`formatBuffConditionText` in `/var/home/mstephens/Documents/GitHub/axiforge/src/renderer/modules/detail-panel.js`) into a pure TS mapper producing our `EntityFact` rows. Drop AxiForge's per-fact `<img>` icons and weapon-damage math (we have no weapon stats here) — text rows only.
- Feed those into our existing themed `EntityCard` (`description` + `facts` already render). Enlarge the icon.

Reference (read, don't import — it's app code, not the npm lib): AxiForge `detail-panel.js` `formatFactHtml` (~L719-841) + `formatBuffConditionText` (~L701). Use `normalizeFactType` + `stripGw2Markup` from `@axiapps/gw2-data` (installed).

## Global Constraints
- ESM, no file extensions in imports. Tests co-located, `npx vitest run <file> --maxWorkers=2`.
- Entity types exactly `'skill' | 'trait' | 'item'`. Type shapes stay lockstep.
- Full suite stays green; renderer typecheck stays at the 1 known pre-existing `App.test.tsx` error; main entities typecheck 0.
- `Gw2ApiClient.fetchByIds(endpoint, ids, lang?)` is in `node_modules/@axiapps/gw2-data/src/api/client.js` — returns the raw GW2 API objects array (each with `id, name, description, icon, chat_link, facts[]`). It caches internally (MemoryCache). The `icon` is already a full URL.
- Note: Gw2ApiClient.fetchByIds does not cache; repeat detail fetches are avoided by EntityService's per-entity success cache, not the client.

---

### Task E: GW2 fact → EntityFact mapper (pure, ported from AxiForge)

**Files:** `src/main/entities/gw2Facts.ts`, `src/main/entities/gw2Facts.test.ts`; extend `src/main/meta/gw2-data.d.ts`.

- Extend `src/main/meta/gw2-data.d.ts` (the `declare module '@axiapps/gw2-data'` block) with:
  ```ts
  export class Gw2ApiClient {
    constructor(opts?: { cache?: unknown; fetch?: typeof fetch; apiRoot?: string; lang?: string })
    fetchByIds(endpoint: string, ids: number[], lang?: string): Promise<Gw2ApiEntity[]>
  }
  export interface Gw2ApiEntity { id: number; name?: string; description?: string; icon?: string; chat_link?: string; facts?: Gw2Fact[] }
  export interface Gw2Fact { type?: string; text?: string; icon?: string; value?: number; duration?: number; status?: string; description?: string; apply_count?: number; dmg_multiplier?: number; hit_count?: number; distance?: number; percent?: number; field_type?: string; finisher_type?: string; target?: string; source?: string; [k: string]: unknown }
  export function normalizeFactType(type: string): string
  export function stripGw2Markup(text: string): string
  ```
- Create `gw2Facts.ts` exporting:
  - `formatFact(fact: Gw2Fact): { label: string; value?: string } | null` — pure, ported from AxiForge's `formatFactHtml` TEXT branches. Handle the common normalized types (use `normalizeFactType` first, `stripGw2Markup` on text/description):
    - `Recharge`: label `'Recharge'`, value `\`${value}s\``
    - `Time`: label from `fact.text || 'Duration'`, value `\`${duration}s\``
    - `Range` / `Radius` / `Distance`: label `fact.text || 'Range'`, value `String(value ?? distance)`
    - `Number`: label `fact.text`, value `String(value)`
    - `Percent`: label `fact.text`, value `\`${percent}%\``
    - `AttributeAdjust`: label `fact.text`, value `\`${value>0?'+':''}${value}\``
    - `Buff` / `ApplyBuffCondition` / `PrefixedBuff` (normalize→`Buff`): use a ported `formatBuffConditionText(fact)` → a single string; return `{ label: that, value: undefined }` (name ×stacks (duration): description)
    - `ComboFinisher`: label `'Combo Finisher'`, value `fact.finisher_type` (+ ` (${percent}%)` if present)
    - `ComboField`: label `'Combo Field'`, value `fact.field_type`
    - `Damage`: label `fact.text || 'Damage'`, value derived from `hit_count`/`dmg_multiplier` as a readable string (e.g. `\`×${dmg_multiplier} (${hit_count} hits)\``); no weapon math
    - `Unblockable`/`StunBreak`/`NoData`: return `null` (or a plain label with no value for StunBreak — your call; keep it simple, `null` is fine) — document the choice in a comment
    - Unknown type: if `fact.text`, return `{ label: stripGw2Markup(fact.text) }`, else `null`
  - `formatFacts(facts: Gw2Fact[] | undefined, max = 10): { label: string; value?: string }[]` — map + drop nulls + cap at `max`.
- Tests (`gw2Facts.test.ts`): one representative fact object per handled type asserting the produced row; a Buff with `apply_count>1` and `duration` produces `Name ×N (Ds)`; unknown-type-with-text falls back to the text; null-returning types are dropped by `formatFacts`; `formatFacts` caps at max. Write tests first (RED), then implement (GREEN).

Reviewer focus: the port matches AxiForge's intent for each type; `stripGw2Markup`/`normalizeFactType` applied; no weapon-stat math leaked in; null handling; cap.

---

### Task F: Resolve skills/traits via Gw2ApiClient (id index + description + facts)

**Files:** `src/main/entities/dictionary.ts` (fetch id), `service.ts`, `src/main/index.ts`; tests.

- `fetchGw2Entities` now also returns `id`: `Promise<{ id: number; name: string; icon?: string }[]>` (rows already have `id`). Update its test.
- The service's data/index: extend the per-entity index to `Map<string, { id: number; icon?: string }>` keyed `type:name` (was icon-only). `ensureData`/`ensureIconIndex` → rename/extend to `ensureEntityIndex` returning that map. `dictionary()` still builds names+icons from the same data.
- Add a service dep `fetchEntityDetail: (endpoint: 'skills'|'traits', id: number) => Promise<{ description?: string; icon?: string; facts?: Gw2Fact[] } | null>` (injected for tests). In `src/main/index.ts`, back it with a module-level `Gw2ApiClient`: `const gw2Api = new Gw2ApiClient(); fetchEntityDetail: async (e,id) => (await gw2Api.fetchByIds(e,[id]))[0] ?? null`.
- `resolve` for skill/trait:
  - look up `{ id, icon }` from the index (await ensureEntityIndex).
  - if id present: `const detail = await this.deps.fetchEntityDetail(input.type==='skill'?'skills':'traits', id)`.
  - Build the card: `name` (input name), `subtitle` (`'Skill'`/`'Trait'` — keep current), `icon: detail?.icon ?? indexIcon`, `description: detail?.description ? stripGw2Markup(detail.description) : undefined`, `facts: formatFacts(detail?.facts)`, `wikiUrl: wikiUrlFor(name)`.
  - This REPLACES the current `wikiFactsToCard` path for the card body. Keep `wikiFactsToCard`/`WikiFacts` dep in the codebase but the service no longer needs the `wikiFacts` dep for resolve — remove that dep from `EntityService` (and its construction in index.ts) ONLY if nothing else uses it; if `WikiFactsClient` is referenced elsewhere leave that import alone. (Check: `grep -rn wikiFacts src/main`.)
  - Items unchanged (catalog). Successes-only cache unchanged; never cache a miss (a null detail with no icon → still produce a minimal card? Prefer: if detail is null AND no index icon, return a name-only card with empty facts so the link still hovers "no data"-ish — or return the card with whatever we have. Keep it simple: always return a card for a known skill/trait name in the index; facts may be empty.)
- Update `service.test.ts`: inject a fake `fetchEntityDetail` returning `{ description, facts:[…] }`; assert a resolved skill card has the description (markup-stripped) and mapped facts and the icon; keep cache invariants. Remove now-irrelevant wiki recharge assertions (or keep wiki dep if retained).

Reviewer focus: id index keying matches lookup; single GW2 list-fetch preserved (Gw2ApiClient caches detail calls); description stripped; facts via formatFacts; cache invariants; no orphan wiki wiring left half-removed; lockstep.

---

### Task G: Bigger icon + card polish (CSS)

**Files:** `src/renderer/src/theme.css` (and `entityCard.ts` only if a class is needed).

- Card header icon `.axi-ecard__icon`: 40px → **54px**, border-radius 4→5px (keep `object-fit:cover; border:1px solid var(--rule); background:#2a2c31`). Bump `.axi-ecard__hd` gap to ~12px.
- Inline `.axi-entity__ico`: `1.05em` → **1.2em** (keep border/radius).
- Ensure `.axi-ecard__desc` is styled (margin-bottom, `color:var(--ink-dim)`, line-height) so the new description reads well; widen `.axi-ecard-pop` from 300 → **312px** to fit the richer body.
- No logic changes; `entityCard.test.ts` must still pass.

Reviewer focus: CSS only; tokens used; sizes match the approved mock; no dead rules.

---

## Verification (controller)
Full suite green; renderer typecheck = 1 pre-existing; main entities typecheck 0. Then live in-app: hover a marked skill → card shows real icon (bigger), description, and a full fact list mapped from the GW2 API.

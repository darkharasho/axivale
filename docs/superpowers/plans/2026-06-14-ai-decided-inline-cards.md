# AI-Decided Inline Build/Comp Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inline figures in the article render only where the AI places a `{{figure}}` marker; unmarked tool displays (lookups, full comp rosters) no longer dump at the end — they stay in the Actions rail. Build/comp cards thus appear inline only when the AI chooses.

**Architecture:** Remove the "leftover figures" render in `Article.tsx` so only marked positions render (tables already excluded; tables remain Actions-only). Clarify the system prompt. The Actions rail/modal already render every tool card. The share viewer is unchanged (no Actions panel there).

**Tech Stack:** React 18, TypeScript, @testing-library/react + jsdom, vitest.

**Conventions:** Run tests with `npx vitest run <file> --maxWorkers=2`. Commit per task.

---

## Task 1: Only marked figures render inline (drop the leftover dump)

**Files:**
- Modify: `src/renderer/src/components/Article.tsx`
- Modify: `src/renderer/src/components/Article.test.tsx`

- [ ] **Step 1: Update the test to the new behavior**

In `src/renderer/src/components/Article.test.tsx`, replace the existing test titled `appends a chart figure at the end when no marker is present` with this (it now asserts the opposite — no inline figure without a marker):

```tsx
  it('does NOT render a chart figure inline when there is no {{figure}} marker', () => {
    const { container } = render(
      <Article turn={doneTurn({ agentText: 'Headline\n\nNo marker here.', tools: [chartTool] })} conversationId={null} />
    )
    expect(container.querySelector('.post-figure')).toBeNull()
    expect(container.querySelector('.richchart')).toBeNull()
  })
```

Leave the other figure tests as-is (marked chart renders inline; tool table never inline; errored tool renders nothing).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/Article.test.tsx --maxWorkers=2`
Expected: FAIL — the unmarked chart still renders inline via the leftover dump (`.post-figure` found).

- [ ] **Step 3: Remove the leftover-figure render**

In `src/renderer/src/components/Article.tsx`, delete the leftover block (the comment + the `figures.slice(...)` line) inside the figure IIFE so only marker positions render. Change:

```tsx
                    {segments.map((seg, i) => (
                      <Fragment key={i}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeEmojiIcons]}
                          components={{ span: renderEmojiSpan }}
                        >
                          {seg}
                        </ReactMarkdown>
                        {i < segments.length - 1 && figures[i] && renderFigure(figures[i])}
                      </Fragment>
                    ))}
                    {/* Leftover figures (fewer markers than figures, incl. the
                        no-marker case) render after the prose. */}
                    {figures.slice(Math.max(0, segments.length - 1)).map(renderFigure)}
                  </>
```

to:

```tsx
                    {segments.map((seg, i) => (
                      <Fragment key={i}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeEmojiIcons]}
                          components={{ span: renderEmojiSpan }}
                        >
                          {seg}
                        </ReactMarkdown>
                        {i < segments.length - 1 && figures[i] && renderFigure(figures[i])}
                      </Fragment>
                    ))}
                  </>
```

Also update the explanatory comment just above the IIFE (currently describing inline placement + "With no markers, all figures fall to the end") to:

```tsx
              {/* Inline figures (charts, build/comp cards) render ONLY where the
                  model writes {{figure}}, in order. Unmarked tool displays are
                  not dumped here — they live in the Actions rail. Tool data
                  tables are excluded from inline entirely. */}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Article.test.tsx --maxWorkers=2`
Expected: PASS (all figure tests, including the new no-marker assertion).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Article.tsx src/renderer/src/components/Article.test.tsx
git commit -m "feat(article): only {{figure}}-marked displays render inline (no leftover dump)"
```

---

## Task 2: Clarify the system prompt

**Files:**
- Modify: `src/main/agent.ts`

- [ ] **Step 1: Update the figure-placement guidance**

In `src/main/agent.ts`, find the bullet that currently reads (the block ending with):

```
  Use {{figure}} for charts and build/comp cards only. A tool's DATA TABLE does
  not render inline — it appears automatically as a card in the right-hand
  Actions panel — so never {{figure}} a tool table; just reference it ("full
  per-player breakdown is in Actions"). A short, curated table you write yourself
  in markdown IS fine inline.
```

Replace it with:

```
  Use {{figure}} for charts and build/comp cards only. ONLY what you mark with
  {{figure}} renders inline — anything you fetched just to look something up
  (a full comp roster, a list of builds, a data table) is NOT shown inline; it is
  browsable as a card in the right-hand Actions panel, so don't try to surface it
  in the reply. Render a build-card/comp-card inline (via {{figure}}) only to
  illustrate a specific point (e.g. "here's the recommended healer build"). Never
  {{figure}} a tool data table; reference it ("full breakdown is in Actions"). A
  short, curated table you write yourself in markdown IS fine inline.
  do NOT pile every figure at the end.
```

(The phrase `do NOT pile every figure at the end` is retained because `systemPrompt.test.ts` asserts it; `{{figure}}` is also retained.)

- [ ] **Step 2: Run the system prompt test**

Run: `npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2`
Expected: PASS (the `{{figure}}` and "do NOT pile every figure at the end" assertions still hold).

- [ ] **Step 3: Commit**

```bash
git add src/main/agent.ts
git commit -m "feat(agent): only marked figures render inline; lookups live in Actions"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

`npm run dev`: ask the agent something that pulls a comp/build lookup without asking it to show one (e.g. "which build should our second alac run?") — the article should be prose, with the comp/build details browsable in the Actions rail, and NOT dumped at the end. Then ask it to "show me the recommended firebrand build" — it should render that `build-card` inline where it writes `{{figure}}`. A WvW report's per-player table stays in Actions.

---

## Self-Review Notes

- **Spec coverage:** marker-only inline (Task 1, removing the leftover slice); tables stay Actions-only (unchanged filter retained); prompt clarification (Task 2); Actions rail/modal + share viewer unchanged (no tasks, by design); testing per task. All mapped.
- **No placeholders / type consistency:** the only code change is deleting the leftover render and editing two comments/strings; `figures`, `renderFigure`, `segments` are unchanged in shape. `chartTool`/`doneTurn` already exist in `Article.test.tsx` (used by the sibling figure tests).

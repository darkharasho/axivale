# Discord Deeper History + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AxiVale agent read deep Discord channel/thread history (not just the last 100 messages) and filter it. Extend the AxiTools bot's messages endpoint to page (`before`/`after`) and to read threads (`thread_id`); add a paging-aware `discord_messages` tool plus a new `discord_search` tool that scans a bounded window and reports its scan cap honestly.
**Working directories:** /var/home/mstephens/Documents/GitHub/axitools (bot), /var/home/mstephens/Documents/GitHub/axivale (client/tools)
**Architecture:** A Python aiohttp+discord.py bot (axitools) exposes `GET /guilds/{id}/discord/messages`; an Electron+TypeScript client (axivale) calls it via `AxitoolsClient` and surfaces it to the agent as MCP tools (`src/main/tools/discord.ts`). The bot resolves channels/threads through `discord_actions.resolve_channel` (already thread-aware via `get_channel_or_thread`) and serializes snowflakes as strings (`_sid`) and datetimes as ISO (`_iso`). The client builds query strings and never throws into the agent (the `safe()` wrapper turns errors into MCP error results). Discord gives bots no server-side message search, so `discord_search` is a client-side filter over a bounded fetched window — the cap is always surfaced.
**Tech Stack:** Python (aiohttp + discord.py 2.6) bot; Electron+TS client; pytest + vitest

---

## File Structure

```
axitools/
  axitools/api/server.py          # MODIFY: parse_history_window() helper + _handle_discord_messages
  tests/test_api_discord.py       # MODIFY: add window-parsing + thread + paging tests
axivale/
  src/main/axitoolsClient.ts      # MODIFY: discordMessages(guildId, opts) options object
  src/main/axitoolsClient.test.ts # MODIFY: query-string building for new params
  src/main/tools/discord.ts       # MODIFY: discord_messages params; NEW discord_search tool
  src/main/tools/index.ts         # MODIFY: (no change needed — discord_search is added inside buildDiscordTools)
  src/main/tools/inventory.test.ts# MODIFY: +1 tool name (discord_search)
  src/main/tools.test.ts          # MODIFY: discordMessages call shape; discord_search tool tests
  src/main/agent.ts               # MODIFY: AXIVALE_SYSTEM_PROMPT paging + search-cap guidance
  src/main/systemPrompt.test.ts   # MODIFY: assertions for new guidance
```

**Note on the AxiTools harness:** `tests/test_api_discord.py` already drives the real `_handle_discord_messages` through a fake aiohttp app (`FakeChannel.history(limit=...)`). The fake `history` currently ignores `before`/`after`, and the fakes have no thread-id resolution. Rather than reproduce discord.py's full `before`/`after` semantics in the fake (which would test the fake, not the bot), we factor the request-string→kwargs parsing into a pure helper `parse_history_window(query)` and unit-test THAT exhaustively (the genuinely tricky logic: digits→`discord.Object`, ISO→aware `datetime`, garbage→error). We then add thin integration tests over the existing fake harness for: `thread_id` routing to `resolve_channel`, that a bad `before` yields 400 before any history read, and that the limit/missing-channel paths still hold. Passing `before=`/`after=` through to a live `channel.history` is exercised only against a real Discord connection (manual/staging) — called out in Task 1.

---

## Task 1 — AxiTools: `parse_history_window` helper + `thread_id`/`before`/`after` in `_handle_discord_messages`

`resolve_channel` (in `axitools/api/discord_actions.py`) already resolves a thread when the guild exposes `get_channel_or_thread`, so `thread_id` just means "use this id as the channel id." We require exactly one of `channel_id` / `thread_id`. `before`/`after` are each either a snowflake (all-digits → `discord.Object(id=int)`) or an ISO-8601 date/datetime (`datetime.fromisoformat`, coerced to UTC-aware) — anything else is a 400.

- [ ] **1a. Write failing tests.** Append to `/var/home/mstephens/Documents/GitHub/axitools/tests/test_api_discord.py`:

```python
# ---------------------------------------------------------------------------
# parse_history_window (pure) — the digits/ISO/garbage logic
# ---------------------------------------------------------------------------

from multidict import MultiDict

from axitools.api.server import parse_history_window


def _win(**params):
    """parse_history_window takes a mapping like request.query."""
    return parse_history_window(MultiDict(params))


def test_window_defaults_to_no_bounds():
    win, err = _win()
    assert err is None
    assert win == {"before": None, "after": None}


def test_window_before_after_as_snowflake_ids():
    win, err = _win(before="101", after="100")
    assert err is None
    assert isinstance(win["before"], discord.Object)
    assert win["before"].id == 101
    assert isinstance(win["after"], discord.Object)
    assert win["after"].id == 100


def test_window_before_as_iso_date_is_utc_aware():
    win, err = _win(before="2026-06-10")
    assert err is None
    value = win["before"]
    assert isinstance(value, dt.datetime)
    assert value == dt.datetime(2026, 6, 10, tzinfo=UTC)


def test_window_after_as_iso_datetime_with_offset():
    win, err = _win(after="2026-06-10T08:30:00+00:00")
    assert err is None
    assert win["after"] == dt.datetime(2026, 6, 10, 8, 30, tzinfo=UTC)


def test_window_garbage_before_is_error():
    win, err = _win(before="not-a-date")
    assert win is None
    assert "before" in err


def test_window_garbage_after_is_error():
    win, err = _win(after="2026-13-99")
    assert win is None
    assert "after" in err


# ---------------------------------------------------------------------------
# GET /guilds/{id}/discord/messages — thread + paging integration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_messages_reads_a_thread_by_thread_id(api_client, bot):
    guild = bot.get_guild(123)
    author = FakeMember(30, "logan")
    thread = FakeChannel(
        77, "raid-plans", guild, type="public_thread",
        messages=[FakeMessage(201, author, "thread msg")],
    )
    guild.channels.append(thread)
    resp = await api_client.get(
        "/guilds/123/discord/messages?thread_id=77", headers=_auth()
    )
    assert resp.status == 200
    body = await resp.json()
    assert [m["id"] for m in body] == ["201"]


@pytest.mark.asyncio
async def test_messages_requires_channel_or_thread(api_client):
    resp = await api_client.get("/guilds/123/discord/messages", headers=_auth())
    assert resp.status == 400
    assert "channel_id or thread_id" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_messages_bad_before_is_400_before_reading(api_client):
    resp = await api_client.get(
        "/guilds/123/discord/messages?channel_id=11&before=garbage", headers=_auth()
    )
    assert resp.status == 400
    assert "before" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_messages_accepts_before_after_passthrough(api_client):
    # The fake channel ignores before/after; this asserts valid params don't 400
    # and the response shape is unchanged. (Live before/after filtering is
    # verified against a real Discord connection — see plan note.)
    resp = await api_client.get(
        "/guilds/123/discord/messages?channel_id=11&before=101&after=2026-06-01",
        headers=_auth(),
    )
    assert resp.status == 200
    assert [m["id"] for m in await resp.json()] == ["101", "100"]


@pytest.mark.asyncio
async def test_messages_unknown_thread_404(api_client):
    resp = await api_client.get(
        "/guilds/123/discord/messages?thread_id=99999", headers=_auth()
    )
    assert resp.status == 404
    assert "not found in this server" in (await resp.json())["error"]
```

  Also update the existing `FakeChannel.history` to accept (and ignore) `before`/`after` so passthrough doesn't blow up. Replace its `history` method:

```python
    def history(self, *, limit, before=None, after=None):
        messages = self.messages[:limit]

        async def _gen():
            for message in messages:
                yield message

        return _gen()
```

- [ ] **1b. Run, expect fail.** `cd /var/home/mstephens/Documents/GitHub/axitools && pytest tests/test_api_discord.py -v`
  Expected: `ImportError: cannot import name 'parse_history_window'` (collection error), and the new endpoint tests fail.

- [ ] **1c. Implement.** In `/var/home/mstephens/Documents/GitHub/axitools/axitools/api/server.py`, add the helper near the other `_iso`/`_sid` helpers (above `_handle_discord_messages`, ~line 650). `discord` and `from aiohttp import web` are already imported at the top of the file; add `import datetime as _dt` to the existing import block if not present (the file imports stdlib modules at the top — add it there):

```python
def parse_history_window(query):
    """Parse before/after history params from a request query mapping.

    Each of *before* / *after* is optional and may be either a Discord
    snowflake id (all digits → discord.Object) or an ISO-8601 date/datetime
    (→ UTC-aware datetime). Returns (window, None) on success or
    (None, error_message) on a value that is neither.
    """
    window: dict = {}
    for key in ("before", "after"):
        raw = (query.get(key) or "").strip()
        if not raw:
            window[key] = None
            continue
        if raw.isdigit():
            window[key] = discord.Object(id=int(raw))
            continue
        try:
            parsed = _dt.datetime.fromisoformat(raw)
        except ValueError:
            return None, f"{key} must be a message id (digits) or an ISO-8601 date"
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=_dt.timezone.utc)
        window[key] = parsed
    return window, None
```

  Then replace `_handle_discord_messages` (lines ~651-680) with:

```python
async def _handle_discord_messages(request: web.Request) -> web.Response:
    guild, err = _resolve_discord_guild(request)
    if err is not None:
        return err
    raw_thread_id = request.query.get("thread_id", "")
    raw_channel_id = request.query.get("channel_id", "")
    target_id = raw_thread_id if raw_thread_id else raw_channel_id
    if not target_id.isdigit():
        return web.json_response(
            {"error": "channel_id or thread_id query parameter is required"},
            status=400,
        )
    raw_limit = request.query.get("limit", "25")
    if not raw_limit.isdigit() or not 1 <= int(raw_limit) <= 100:
        return web.json_response(
            {"error": "limit must be an integer between 1 and 100"}, status=400
        )
    window, window_err = parse_history_window(request.query)
    if window_err is not None:
        return web.json_response({"error": window_err}, status=400)
    try:
        channel = discord_actions.resolve_channel(guild, int(target_id))
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=404)
    messages = [
        {
            "id": _sid(m.id),
            "author_id": _sid(m.author.id),
            "author_name": m.author.name,
            "content": m.content,
            "created_at": _iso(m.created_at),
            "pinned": getattr(m, "pinned", False),
        }
        async for m in channel.history(
            limit=int(raw_limit), before=window["before"], after=window["after"]
        )
    ]
    return web.json_response(messages)
```

  (No route change needed: the existing `app.router.add_get(".../discord/messages", _handle_discord_messages)` registration already covers all the new query params.)

  **Live-only verification (not unit-testable):** the actual `before=`/`after=` filtering and archived-thread resolution depend on a real `discord.py` connection. Verify manually against staging: `GET /guilds/{id}/discord/messages?channel_id={c}&before={oldest_id_from_first_page}` returns the page *before* that id, and `thread_id` of an archived thread resolves.

- [ ] **1d. Run, expect pass.** `cd /var/home/mstephens/Documents/GitHub/axitools && pytest tests/test_api_discord.py -v`

- [ ] **1e. Commit.** `cd /var/home/mstephens/Documents/GitHub/axitools && git add -A && git commit -m "feat(api): discord messages endpoint supports thread_id + before/after paging"`

---

## Task 2 — AxiVale client: `discordMessages(guildId, opts)` query building

Change the signature from positional `(guildId, channelId, limit?)` to an options object so it can carry `channelId`, `threadId`, `limit`, `before`, `after`. This is a breaking signature change; Tasks 3 and the tests update all callers.

- [ ] **2a. Write failing test.** Replace the existing `it('fetches channel messages with a limit', ...)` block (lines ~62-68) in `/var/home/mstephens/Documents/GitHub/axivale/src/main/axitoolsClient.test.ts` with:

```typescript
  it('fetches channel messages with a limit (options object)', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.discordMessages('123', { channelId: '555', limit: 50 })
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8642/guilds/123/discord/messages?channel_id=555&limit=50'
    )
  })

  it('builds thread + before/after query params, omitting empties', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.discordMessages('123', {
      threadId: '777',
      before: '101',
      after: '2026-06-01'
    })
    const url = new URL(mockFetch.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/guilds/123/discord/messages')
    expect(url.searchParams.get('thread_id')).toBe('777')
    expect(url.searchParams.get('before')).toBe('101')
    expect(url.searchParams.get('after')).toBe('2026-06-01')
    expect(url.searchParams.has('channel_id')).toBe(false)
    expect(url.searchParams.has('limit')).toBe(false)
  })
```

- [ ] **2b. Run, expect fail.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/axitoolsClient.test.ts --maxWorkers=2`
  Expected: type/runtime failure — `discordMessages` still takes `(guildId, channelId, limit)`, so `{ channelId: '555', limit: 50 }` is the wrong argument shape and the URL assertion fails.

- [ ] **2c. Implement.** Replace `discordMessages` (lines ~97-101) in `/var/home/mstephens/Documents/GitHub/axivale/src/main/axitoolsClient.ts`:

```typescript
  discordMessages(
    guildId: string,
    opts: {
      channelId?: string
      threadId?: string
      limit?: number
      before?: string
      after?: string
    }
  ): Promise<unknown> {
    const qs = new URLSearchParams()
    if (opts.channelId) qs.set('channel_id', opts.channelId)
    if (opts.threadId) qs.set('thread_id', opts.threadId)
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit))
    if (opts.before) qs.set('before', opts.before)
    if (opts.after) qs.set('after', opts.after)
    return this.request('GET', `/guilds/${guildId}/discord/messages?${qs}`)
  }
```

- [ ] **2d. Run, expect pass.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/axitoolsClient.test.ts --maxWorkers=2`

- [ ] **2e. Commit.** `cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "feat(axitools-client): discordMessages takes an options object (channel/thread/limit/before/after)"`

---

## Task 3 — AxiVale `discord_messages` tool: new params + paging guidance

- [ ] **3a. Write failing test.** Replace the existing `it('discord_messages reads a channel', ...)` block (lines ~123-129) in `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools.test.ts` with:

```typescript
  it('discord_messages forwards channel/thread/limit/before/after', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const messages = tools.find((t) => t.name === 'discord_messages')!
    await messages.handler({ channel_id: '555', limit: 50 }, {})
    expect(deps.axitools.discordMessages).toHaveBeenCalledWith('123', {
      channelId: '555',
      threadId: undefined,
      limit: 50,
      before: undefined,
      after: undefined
    })
    await messages.handler({ thread_id: '777', before: '101' }, {})
    expect(deps.axitools.discordMessages).toHaveBeenCalledWith('123', {
      channelId: undefined,
      threadId: '777',
      limit: undefined,
      before: '101',
      after: undefined
    })
  })
```

- [ ] **3b. Run, expect fail.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools.test.ts --maxWorkers=2`
  Expected: the handler still calls `discordMessages('123', channel_id, limit)` positionally, so `toHaveBeenCalledWith('123', { ... })` fails.

- [ ] **3c. Implement.** Replace the `discord_messages` tool block (lines ~33-43) in `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools/discord.ts`:

```typescript
    tool(
      'discord_messages',
      'Read messages from a channel or thread in the connected Discord server, newest first (default 25, max 100). Pass channel_id OR thread_id (ids from discord_overview). To read OLDER messages, call again with `before` set to the oldest message id you got in the previous page. `before`/`after` each accept a message id or an ISO-8601 date (e.g. "2026-06-01"); after bounds the oldest, before bounds the newest.',
      {
        channel_id: z.string().optional().describe('Channel id (from discord_overview)'),
        thread_id: z.string().optional().describe('Thread id to read instead of a channel'),
        limit: z.number().optional().describe('How many messages, max 100'),
        before: z.string().optional().describe('Message id or ISO date — return messages older than this'),
        after: z.string().optional().describe('Message id or ISO date — return messages newer than this')
      },
      safe(async ({ channel_id, thread_id, limit, before, after }) =>
        deps.axitools.discordMessages(requireDiscordGuild(deps), {
          channelId: channel_id,
          threadId: thread_id,
          limit,
          before,
          after
        })
      )
    ),
```

- [ ] **3d. Run, expect pass.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools.test.ts --maxWorkers=2`

- [ ] **3e. Commit.** `cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "feat(tools): discord_messages supports thread_id + before/after paging"`

---

## Task 4 — AxiVale `discord_search` tool: bounded paged client-side search

`discord_search` pages `discordMessages` newest→older (≤100 per page), filtering each message by an optional substring `query` (case-insensitive over content), optional `author` (case-insensitive match on `author_name` OR exact `author_id`), and optional `from`/`to` ISO date bounds (over `created_at`). It stops when it has scanned `max_messages` (default 500, hard cap 1000) or a page comes back short (channel exhausted). It returns `{ matches, scanned, reachedCap, oldestScannedAt }`. Compact value, no rich display (listings stay action cards, per the established rule).

We page by setting `before` to the oldest scanned message id (not a date) so paging is exact. Because the bot already filters by `after` server-side, we also pass the `from` date as `after` to skip ancient history when the user gave a lower bound — but we still client-side-filter to keep the contract simple and testable.

- [ ] **4a. Write failing test.** Create `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools/discordSearch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildDiscordTools } from './discord'
import type { ToolDeps } from './shared'

interface Msg {
  id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
  pinned: boolean
}

function msg(id: number, author: string, content: string, day: number): Msg {
  return {
    id: String(id),
    author_id: `a${author}`,
    author_name: author,
    content,
    created_at: `2026-06-${String(day).padStart(2, '0')}T12:00:00+00:00`,
    pinned: false
  }
}

/**
 * Fake client whose discordMessages serves a fixed newest-first corpus, honoring
 * the `before` (message id) and `limit` paging the tool drives it with.
 */
function makeDeps(corpus: Msg[]): { deps: ToolDeps; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  const discordMessages = vi.fn(async (_guild: string, opts: Record<string, unknown>) => {
    calls.push(opts)
    let pool = corpus
    if (opts.before) {
      const cut = corpus.findIndex((m) => m.id === opts.before)
      pool = cut >= 0 ? corpus.slice(cut + 1) : corpus
    }
    const limit = (opts.limit as number) ?? 25
    return pool.slice(0, limit)
  })
  const deps = {
    axitools: { discordMessages } as never,
    gw2: {} as never,
    discordGuildId: () => '123',
    gw2GuildId: () => 'g1',
    axiforge: {} as never,
    axiforgeLauncher: { ensureRunning: async () => {} },
    axibridge: () => ({}) as never
  } satisfies ToolDeps
  return { deps, calls }
}

function search(deps: ToolDeps) {
  return buildDiscordTools(deps).find((t) => t.name === 'discord_search')!
}

describe('discord_search', () => {
  it('filters by case-insensitive substring across pages', async () => {
    const corpus = Array.from({ length: 150 }, (_, i) =>
      msg(1000 - i, 'logan', i % 50 === 0 ? 'the RESET plan' : 'chatter', 11)
    )
    const { deps, calls } = makeDeps(corpus)
    const res = await search(deps).handler(
      { channel_id: '11', query: 'reset' },
      {}
    )
    const out = JSON.parse(res.content[0].text)
    expect(out.matches.map((m: Msg) => m.id)).toEqual(['1000', '950', '900'])
    expect(out.scanned).toBe(150)
    expect(out.reachedCap).toBe(false)
    // paged: first call no before, later calls page by oldest id
    expect(calls[0].before).toBeUndefined()
    expect(calls[1].before).toBe('901')
  })

  it('filters by author (name or id)', async () => {
    const corpus = [
      msg(5, 'logan', 'hi', 11),
      msg(4, 'rytlock', 'ho', 11),
      msg(3, 'LOGAN', 'hey', 11)
    ]
    const { deps } = makeDeps(corpus)
    const byName = JSON.parse(
      (await search(deps).handler({ channel_id: '11', author: 'logan' }, {})).content[0].text
    )
    expect(byName.matches.map((m: Msg) => m.id)).toEqual(['5', '3'])
    const byId = JSON.parse(
      (await search(deps).handler({ channel_id: '11', author: 'arytlock' }, {})).content[0].text
    )
    expect(byId.matches.map((m: Msg) => m.id)).toEqual(['4'])
  })

  it('bounds matches by from/to ISO dates', async () => {
    const corpus = [msg(3, 'logan', 'a', 12), msg(2, 'logan', 'b', 10), msg(1, 'logan', 'c', 8)]
    const { deps } = makeDeps(corpus)
    const out = JSON.parse(
      (await search(deps).handler({ channel_id: '11', from: '2026-06-09', to: '2026-06-11' }, {}))
        .content[0].text
    )
    expect(out.matches.map((m: Msg) => m.id)).toEqual(['2'])
  })

  it('surfaces the cap and oldest scanned timestamp', async () => {
    const corpus = Array.from({ length: 1200 }, (_, i) => msg(2000 - i, 'logan', 'no match here', 11))
    const { deps } = makeDeps(corpus)
    const out = JSON.parse(
      (await search(deps).handler({ channel_id: '11', query: 'zzz', max_messages: 200 }, {}))
        .content[0].text
    )
    expect(out.matches).toEqual([])
    expect(out.scanned).toBe(200)
    expect(out.reachedCap).toBe(true)
    expect(out.oldestScannedAt).toBe('2026-06-11T12:00:00+00:00')
  })

  it('clamps max_messages to the 1000 hard cap', async () => {
    const corpus = Array.from({ length: 1100 }, (_, i) => msg(3000 - i, 'logan', 'x', 11))
    const { deps } = makeDeps(corpus)
    const out = JSON.parse(
      (await search(deps).handler({ channel_id: '11', max_messages: 99999 }, {})).content[0].text
    )
    expect(out.scanned).toBe(1000)
    expect(out.reachedCap).toBe(true)
  })
})
```

- [ ] **4b. Run, expect fail.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools/discordSearch.test.ts --maxWorkers=2`
  Expected: `Cannot read properties of undefined (reading 'handler')` — there is no `discord_search` tool yet.

- [ ] **4c. Implement.** Add to `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools/discord.ts`. First extend the import to pull in `ok` is not needed (we return via `safe`), so just add the new tool object to the returned array (after `discord_messages`, before `discord_action`). Insert this block:

```typescript
    tool(
      'discord_search',
      'Search a Discord channel or thread for messages matching a substring and/or author and/or date range. Discord gives bots no true server search, so this scans a bounded window newest→older (up to max_messages, default 500, hard cap 1000) and filters in code. Returns { matches, scanned, reachedCap, oldestScannedAt }: when reachedCap is true the channel has more history than was scanned — tell the user and offer to narrow by `to`/`from` date or raise max_messages. Pass channel_id OR thread_id.',
      {
        channel_id: z.string().optional().describe('Channel id (from discord_overview)'),
        thread_id: z.string().optional().describe('Thread id to search instead of a channel'),
        query: z.string().optional().describe('Case-insensitive substring to match in message content'),
        author: z.string().optional().describe('Author name (case-insensitive) or exact author id'),
        from: z.string().optional().describe('ISO date — only messages at or after this time'),
        to: z.string().optional().describe('ISO date — only messages at or before this time'),
        max_messages: z
          .number()
          .optional()
          .describe('How many messages to scan before stopping (default 500, hard cap 1000)')
      },
      safe(async ({ channel_id, thread_id, query, author, from, to, max_messages }) => {
        const guildId = requireDiscordGuild(deps)
        const cap = Math.min(Math.max(1, max_messages ?? 500), 1000)
        const needle = query?.toLowerCase()
        const authorNeedle = author?.toLowerCase()
        const fromMs = from ? Date.parse(from) : undefined
        const toMs = to ? Date.parse(to) : undefined

        const matches: DiscordMessage[] = []
        let scanned = 0
        let oldestScannedAt: string | null = null
        let before: string | undefined

        while (scanned < cap) {
          const pageSize = Math.min(100, cap - scanned)
          const page = (await deps.axitools.discordMessages(guildId, {
            channelId: channel_id,
            threadId: thread_id,
            limit: pageSize,
            before
          })) as DiscordMessage[]
          if (page.length === 0) break
          for (const m of page) {
            scanned += 1
            oldestScannedAt = m.created_at
            if (needle && !m.content.toLowerCase().includes(needle)) continue
            if (
              authorNeedle &&
              m.author_name.toLowerCase() !== authorNeedle &&
              m.author_id !== author
            )
              continue
            const ts = Date.parse(m.created_at)
            if (fromMs !== undefined && ts < fromMs) continue
            if (toMs !== undefined && ts > toMs) continue
            matches.push(m)
          }
          before = page[page.length - 1].id
          if (page.length < pageSize) break
        }
        return { matches, scanned, reachedCap: scanned >= cap, oldestScannedAt }
      })
    ),
```

  Add the message shape type near the top of the file (after the imports, above `DESTRUCTIVE_DISCORD_ACTIONS`):

```typescript
/** Shape the bot returns from /discord/messages (see _handle_discord_messages). */
interface DiscordMessage {
  id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
  pinned: boolean
}
```

- [ ] **4d. Run, expect pass.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools/discordSearch.test.ts --maxWorkers=2`

- [ ] **4e. Update the inventory test.** In `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools/inventory.test.ts`, add `'discord_search'` to the expected names array, keeping it sorted (between `'discord_messages'` and `'discord_overview'`):

```typescript
      'discord_action',
      'discord_messages',
      'discord_search',
      'discord_overview',
```

  Wait — the array is `.sort()`ed, so it must be ASCII-sorted: `discord_action`, `discord_messages`, `discord_overview`, `discord_search` (underscore-`m` < `o` < `s`). Insert `'discord_search'` AFTER `'discord_overview'`:

```typescript
      'discord_action',
      'discord_messages',
      'discord_overview',
      'discord_search',
```

- [ ] **4f. Run, expect pass.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools/inventory.test.ts --maxWorkers=2`

- [ ] **4g. Commit.** `cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "feat(tools): add discord_search — bounded paged client-side message search with surfaced scan cap"`

---

## Task 5 — System prompt: Discord paging + search-cap guidance

- [ ] **5a. Write failing test.** Add to `/var/home/mstephens/Documents/GitHub/axivale/src/main/systemPrompt.test.ts` (inside the existing top-level `describe`, alongside the other `it` blocks):

```typescript
  it('explains Discord paging and the discord_search scan cap', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('discord_search')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/before.*oldest/i)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/reachedCap|scan cap/i)
  })
```

- [ ] **5b. Run, expect fail.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2`
  Expected: `expect(...).toContain('discord_search')` fails — the prompt doesn't mention it yet.

- [ ] **5c. Implement.** In `/var/home/mstephens/Documents/GitHub/axivale/src/main/agent.ts`, replace the existing Discord-management bullet (lines ~32-37, the `- You can manage the connected Discord server directly:` bullet) with:

```typescript
- You can manage the connected Discord server directly: discord_overview for
  the lay of the land (channels, roles, members, ids), discord_messages to
  read a channel or thread, discord_action to act (channels, roles, members,
  messages, threads, events). Look up ids via discord_overview first — never
  guess them. Destructive actions prompt the user to confirm; just call the
  tool and let the confirmation flow happen.
- Reading Discord history: discord_messages returns the newest messages first.
  To read OLDER messages, call it again with \`before\` set to the oldest
  message id from the previous page (or pass an ISO date). To find where
  someone said something, use discord_search (substring/author/date filters).
  It scans a bounded window and returns reachedCap — when reachedCap is true it
  did NOT see the whole channel; say so honestly and offer to narrow by date
  (\`from\`/\`to\`) or raise max_messages rather than implying an exhaustive search.
```

- [ ] **5d. Run, expect pass.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2`

- [ ] **5e. Commit.** `cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "docs(agent): system prompt covers Discord paging + discord_search scan-cap honesty"`

---

## Task 6 — Final verification

- [ ] **6a. AxiVale full suite.** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run --maxWorkers=2` — expect all green (in particular `tools.test.ts`, `axitoolsClient.test.ts`, `tools/discordSearch.test.ts`, `tools/inventory.test.ts`, `systemPrompt.test.ts`).
- [ ] **6b. AxiVale typecheck.** `cd /var/home/mstephens/Documents/GitHub/axivale && npm run typecheck` — expect no errors (the `discordMessages` signature change is fully propagated; `DiscordMessage` cast in `discord_search` typechecks).
- [ ] **6c. AxiTools suite.** `cd /var/home/mstephens/Documents/GitHub/axitools && pytest tests/test_api_discord.py -v` — expect all green.
- [ ] **6d. AxiTools full suite (regression).** `cd /var/home/mstephens/Documents/GitHub/axitools && pytest -q` — confirm no other endpoint test regressed from the `_handle_discord_messages` / `FakeChannel.history` changes.
- [ ] **6e.** If anything fails, fix per superpowers:systematic-debugging before claiming done; re-run the relevant command and confirm output before committing.

---

## Verification notes (not unit-testable)

- **Live `before`/`after` filtering and archived-thread reads** depend on a real discord.py connection; the fake `FakeChannel.history` ignores the bounds. Verified manually against staging (Task 1c). Unit tests cover the param-parsing (`parse_history_window`) and that valid params route correctly / bad params 400 before any read.
- **`discord_search` over real Discord** depends on the live endpoint paging correctly; the unit tests stub the client with a deterministic corpus that honors `before`/`limit`, fully exercising the filter/cap/paging logic. End-to-end correctness rides on Task 1's live check plus 6c.

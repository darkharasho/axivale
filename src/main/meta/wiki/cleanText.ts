// src/main/meta/wiki/cleanText.ts
//
// Second-pass cleaner for GW2-wiki text. @axiapps/gw2-data's stripWikiMarkup only
// resolves {{templates}} and [[links]] — it leaves raw HTML (<br>, <h3>), bold/
// italic quotes ('''…'''), and the entire wikitable syntax ({|, |-, ! colspan=…,
// | style=…) in place. The List-of-skills/traits/runes pages are mostly tables,
// so without this the corpus stored chunks full of "style=text-align:right | |-"
// noise. This strips it to readable prose before chunking + embedding.

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&times;': '×'
}

function decodeEntities(s: string): string {
  let out = s
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v)
  // numeric entities (&#160; etc.)
  out = out.replace(/&#(\d+);/g, (_m, n) => {
    const code = Number(n)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
  })
  return out
}

// HTML attributes that show up in wikitable cells/rows; drop them wholesale.
const TABLE_ATTRS = /\b(?:style|colspan|rowspan|align|valign|class|scope|width|height|bgcolor|cellpadding|cellspacing|border)\s*=\s*"[^"]*"/gi

export function cleanWikiText(input: string): string {
  if (!input) return ''
  let s = input

  // HTML comments and <ref> citations (and their contents)
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<ref[^>]*\/>/gi, ' ')
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
  // Strip all remaining HTML tags (<br>, <h3>, <span …>, …)
  s = s.replace(/<[^>]+>/g, ' ')
  // Decode entities now that tags are gone
  s = decodeEntities(s)

  // Wiki bold/italic markers ('''…''' / ''…'')
  s = s.replace(/'{2,5}/g, '')
  // Section headings (== Notes == → Notes), line-anchored then any inline
  // leftovers (the corpus arrives whitespace-collapsed, so headings can be inline).
  s = s.replace(/^\s*=+\s*(.*?)\s*=+\s*$/gm, '$1')
  s = s.replace(/={2,}/g, ' ')

  // Interlanguage / namespace links left as bare text by stripWikiMarkup
  // ("de:Rune", "Category:Runes", "File:foo.png").
  s = s.replace(/\b(?:de|es|fr|zh|ru|pt|pl|it|cs|ja|ko|nl|sv|fi|tr|uk|vi|th|hu|ar):\S+/g, ' ')
  s = s.replace(/\b(?:Category|File|Image|Media|Template):\S+/g, ' ')
  // Magic words
  s = s.replace(/__[A-Z]+__/g, ' ')
  // Semantic-MediaWiki property annotations ("Has game icon:: Duration.png")
  s = s.replace(/\b[A-Za-z][A-Za-z ]*::\s*[^\s\]|]*/g, ' ')
  // Bare image filenames + leftover sizes from [[File:…|340px]] links
  s = s.replace(/\b[\w-]+\.(?:png|jpg|jpeg|gif|svg)\b/gi, ' ')
  s = s.replace(/\b\d+px\b/g, ' ')

  // --- Wikitable teardown ---
  s = s.replace(TABLE_ATTRS, ' ') // drop cell/row attributes first
  s = s.replace(/\{\|/g, ' ') // table open
  s = s.replace(/\|\}/g, ' ') // table close
  s = s.replace(/\|\+/g, ' ') // caption marker
  s = s.replace(/\|-+/g, ' ') // row separators (|-, |--)
  s = s.replace(/\{\{|\}\}/g, ' ') // stray template braces

  // List / definition markers at the start of a line (*, #, :, ;)
  s = s.replace(/^[*#:;]+\s*/gm, ' ')
  // Inline header-cell markers (space-bounded ! and !!) → separator; a leading !
  // at the very start of a line is also a header cell. Word-attached "!" (an
  // exclamation) is left intact.
  s = s.replace(/^\s*!+/gm, ' · ')
  s = s.replace(/\s!!\s/g, ' · ')
  s = s.replace(/(?<=\s)!(?=\s)/g, ' · ')
  // Remaining pipes are cell delimiters (pipes never occur in GW2 prose).
  s = s.replace(/\|+/g, ' · ')

  // Collapse runs of separators and whitespace.
  s = s.replace(/[ \t]*\n[ \t]*/g, '\n')
  s = s.replace(/(?:\s*·\s*){2,}/g, ' · ') // squeeze "· · ·"
  s = s.replace(/(^|\n)\s*·\s*/g, '$1') // drop leading separators per line
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/\n{2,}/g, '\n')
  return s.trim()
}

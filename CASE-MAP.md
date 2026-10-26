# Case map (for maintainers)

Players see a case number and a story name. The backend knows each case only by its internal ID.
These are separate on purpose: the public number can change, the internal ID never does.

| Story | Public number | Case File no. | Page (canonical URL) | Old URLs (forward to the same story) | Internal ID (immutable) | Mechanic |
|---|---|---|---|---|---|---|
| The Hidden Drop | Case 001 | CR-001-2026 | `/cases/hidden-drop/` | `/case-003.html` | `003` | `hunt` |
| The Missing Envelope | Case 002 | CR-002-2026 | `/cases/missing-envelope/` | `/case-001.html`, `/case-001-secure.html` | `001` | `matrix` |
| The Last Shot | Case 003 | CR-003-2026 | `/cases/last-shot/` | `/case-002.html`, `/case-002-secure.html` | `002` | `dossier` |

## Rules

- **Never change an internal ID.** `case_id` in requests, the database, the server-side answer
  configuration, saved sessions (`caseroom_game_session_<ID>_v1`), other browser storage keys
  (`caseroom_case001_*`, `cr002*`, `cr003_*`) and analytics all use the internal ID.
  In analytics, `003` is the case players know as "Case 001".
- **Public numbers are labels.** To renumber, change the visible text only: page titles and share tags,
  header, status lines, Case File number, footer, copied share text, homepage card, next-case links,
  and the number on the share image (`og-<story>.png`).
- **URLs are story names.** Old numbered URLs stay as forwarding pages and always open the same story.
  Never point an old URL at a different story.
- **A new case** gets a new internal ID (`004`, ...), its own `/cases/<story>/` page, and the next public number.

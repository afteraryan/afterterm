# Analytics

How afterterm learns how people use it: the 22 events it sends, what it never sends, and the rule every new feature follows. Linear: AFT-73 (the decisions, in its comments) and its phases AFT-130 and AFT-131.

Status: planned, not built yet (2026-11-18). Nothing is sent by any released version.

## Why the list is short

A first plan tracked about 107 things: every shortcut, click, menu and screen, with daily counts sent after midnight. It is kept in [`analytics-expanded.md`](analytics-expanded.md). On 2026-11-18 Aryan cut it to the basics, for the sake of scale: how much people use afterterm, how they use Claude in it, how they use loops (and whether rotting works), and numbers worth posting about. Everything is sent when it happens, the way T3 Code does it; nothing is counted up per day and nothing depends on the time of day.

When a question comes up that these events cannot answer, take the events for it from `analytics-expanded.md`, agree them with Aryan, and move them here.

## Every new feature asks about analytics

Aryan's rule, 2026-11-17. Whoever builds a new feature, or changes how an existing one is used, does this before the PR is opened:

1. Read the events below and find what the feature adds that no event covers.
2. Suggest events for it to Aryan in plain words: the event, when it is sent, what it records. Keep the list short: suggest only what answers a real question, and say which ones you would skip and why. `analytics-expanded.md` may already have the event.
3. Add what he agrees to this file and record his answer on the feature's Linear issue. What he turns down goes in "Turned down" below, so nobody suggests it again.
4. Build the agreed events with the feature, under the same rules as the rest (fixed values only, never anything in "Never sent").

A feature with nothing new to track still says so on its issue: "Analytics: nothing new to track", with the reason.

## How it works

- **PostHog,** free plan: 1 million events a month; events over the cap are dropped, never billed.
- **Sent from main** with plain HTTPS to PostHog's `/batch/` endpoint, no PostHog library, following T3 Code's design (`pingdotgg/t3code`, MIT): an id per event, events held in memory, batches of 20 every 10 seconds, longer waits between retries, a rejected batch dropped, a failing batch dropped after 30 minutes, a short flush on quit. Person profiles off.
- **Sent as it happens.** No daily totals, no midnight rule, no clock.
- **The key is not in the repo.** `npm run release` builds it in from an environment variable on Aryan's PC. Dev builds, harness runs, the test build and anyone else's build have no key and send nothing.
- **On for everyone, no switch in the app.** The only way off is the environment variable `AFTERTERM_TELEMETRY_ENABLED=false`, documented for users in `docs/telemetry.md` (written in Phase 1).
- **Users are counted by a random install id,** made on first launch and kept in `%APPDATA%\afterterm`. Nothing is read from Claude Code's or any other tool's files, hashed or not. One person on two PCs is two installs.
- **No session recording.**
- **Time** is sent in UTC; the PostHog project's time zone is Asia/Kolkata, so charts read in IST. Each event also carries the user's own time zone, so their local time can be shown too.
- **How many events:** about one per message and one per Claude turn, plus a few more. A heavy user sends 250 to 300 a day, so the free million covers about 150 active users. Past that it is about $50 per extra million.

## Never sent

- Folder and file paths, file names
- Project, thread and loop names, loop text
- Commands typed and terminal output
- Prompts and Claude's replies
- Claude session and account ids, or anything else from Claude Code's own files
- User and computer names
- Port numbers, branch and worktree names
- Error messages (they can hold paths): only the kind of error and the place in afterterm's code

## Events

Phase 1 is AFT-130, Phase 2 is AFT-131.

### On every event (Phase 1)

| Field | What it records |
|---|---|
| Install id | A random code for this copy of afterterm, made once on first launch, tied to no account |
| Version | afterterm's version |
| Windows | Windows 10 or 11 |
| Time | When it happened, in UTC |
| Time zone | The user's time zone, for example `America/New_York` |
| Country and city | Worked out by PostHog from the address the event came from; the address itself is not kept |

### Time in afterterm (Phase 1)

| Event | When it is sent | What it records |
|---|---|---|
| App opened | Every start | Why: opened by the user, restarted for an update, or the first launch ever. The user's current and longest streak, from Home's calendar |
| App closed | On quit | How long it was open |
| Time in front | When afterterm loses focus, and on quit | Minutes it was in front since it last came to the front, and how many of them had a key press or a click |

### Health (Phase 1)

| Event | When it is sent | What it records |
|---|---|---|
| Update installed | On the first launch after an update | From which version to which |
| Check for updates clicked | The About window's button | What it found: a new version, up to date, or could not check |
| Error | When afterterm hits an error | The kind of error and where in afterterm's code; never the message |

### Claude activity (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Message sent to Claude | Every message | Nothing more |
| Claude finished a turn | When a chat goes from working to done or needs you | How long Claude worked, how many chats were working at that moment, files changed in the turn (documents and code, counted apart), subagents started, the model family (Opus, Sonnet, Haiku or Fable), and whether the chat is in a worktree |
| Chat answered after needing you | When the user replies to a chat that needed them | How long it waited |
| Compaction | Each time a chat compacts | Nothing more |
| Image pasted | Each image pasted into a chat | Nothing more |
| Server started | When a thread starts listening on a port | Nothing more; never the port |
| Thread created | When a thread starts | Chat or shell |
| Thread woken | When an asleep thread wakes | Chat or shell |

### Loops (Phase 2)

These answer one question above all: when a loop rots, do people pick it back up, or drop it?

| Event | When it is sent | What it records |
|---|---|---|
| Loop created | When a loop starts | Feature, bug or idea, and whether Claude or the user started it |
| Loop closed | When a loop closes | Feature, bug or idea, and who closed it |
| Loop started rotting | When a loop reaches 5 days untouched | Feature or bug |
| Rotting loop picked up | The first activity on a rotting loop | What brought it back (its chat opened, its note updated, a ping, a sub-loop added, or work started), who (Claude or the user), and days rotting |
| Loop archived | On archive | Whether it was rotting |
| Loop deleted | On delete | Whether it was rotting |
| Loops opened | When the loops card or Progress opens | Which of the two, and how: the shortcut or a click |
| Open chat from a loop | On click | Whether the chat was open, asleep or closed |

Archived and deleted are separate events, never counted as one (Aryan, 2026-11-17).

## Numbers these events give

What the dashboard can show, and what could be posted:

- Messages sent to Claude this month, by everyone
- Hours Claude worked inside afterterm
- The most chats one person had working at the same time
- The longest streak of days in a row
- Files Claude changed, and how many were documents
- Loops closed, and how many rotting loops came back to life
- How long chats wait for a person, on average
- Dev servers started from afterterm
- How many chats run in a worktree
- Daily and weekly active installs, time in front, by country

## Turned down

Events suggested and turned down, so nobody suggests them again:

- Session recording (2026-11-17): the terminal would show code and secrets, and the rest of the window shows project and thread names.
- Hashed Claude, OpenAI or Codex account ids, and Claude Code's machine id (2026-11-17): installs are counted by afterterm's own random id only.
- A switch in the app to turn analytics off (2026-11-17): the environment variable is the only way, as in T3 Code.
- Token counts (2026-11-17, suggested and left out): they show how much each person spends with Anthropic. Not asked for; raise again only if Aryan brings it up.
- Daily counts sent after midnight (2026-11-18): Aryan did not want anything to depend on the time of day or on afterterm being open at midnight. Everything is sent when it happens.
- The other 85 or so events in `analytics-expanded.md` (2026-11-18): not turned down for good, set aside for scale. Take one from there when a real question needs it.

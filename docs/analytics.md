# Analytics

How afterterm learns how people use it: what is sent, what never is, and the rule every new feature follows. Linear: AFT-73 (the decisions, in its comments) and its phases AFT-130, AFT-131 and AFT-132. The same list, with a switch per event, is the event map page Aryan reviews: https://claude.ai/artifact/Xcrtb7vYQNPtCXRNn9Fpg2. This file is the source of truth in the repo; when the two differ, ask Aryan which is right and fix the other.

Status: planned, not built yet (2026-11-17). Nothing is sent by any released version.

## Every new feature asks about analytics

Aryan's rule, 2026-11-17. Whoever builds a new feature, or changes how an existing one is used, does this before the PR is opened:

1. Read the event list below and find what the feature adds that no event covers: a new button, screen, shortcut, menu item, state or way of doing something.
2. Suggest events for it to Aryan in plain words: the event, when it is sent, what it records. Say which ones you would skip and why.
3. Add what he agrees to this file, and to the event map page, and record his answer on the feature's Linear issue. What he turns down goes in "Turned down" below, so nobody suggests it again.
4. Build the agreed events with the feature, under the same rules as the rest (fixed values only, never anything in "Never sent").

A feature with nothing new to track still says so on its issue: "Analytics: nothing new to track", with the reason.

## How it works

- **PostHog,** free plan: 1 million events a month; events over the cap are dropped, never billed.
- **Sent from main** with plain HTTPS to PostHog's `/batch/` endpoint, no PostHog library, following T3 Code's design (`pingdotgg/t3code`, MIT): an id per event, events held in memory, batches, longer waits between retries, a rejected batch dropped, a failing batch dropped after 30 minutes, a short flush on quit. Person profiles off.
- **The key is not in the repo.** `npm run release` builds it in from an environment variable on Aryan's PC. Dev builds, harness runs, the test build and anyone else's build have no key and send nothing.
- **On for everyone, no switch in the app.** The only way off is the environment variable `AFTERTERM_TELEMETRY_ENABLED=false`, documented for users in `docs/telemetry.md` (written in Phase 1).
- **Users are counted by a random install id,** made on first launch and kept in `%APPDATA%\afterterm`. Nothing is read from Claude Code's or any other tool's files, hashed or not. One person on two PCs is two installs.
- **No session recording.**
- **Time** is sent in UTC; the PostHog project's time zone is Asia/Kolkata, so charts read in IST. Each event also carries the user's own time zone and local time.
- **Busy events are sent live** (Aryan, 2026-11-17). If users grow toward the free cap, thread switches, hover cards, toasts and chat states move to daily counts in a release; keyboard shortcuts are counted daily from the start.
- **What "sent once a day" means** (2026-11-17). Daily counts (keyboard shortcuts, right-click copy and paste, Claude activity, and the other "once a day" rows) are kept per local calendar day, in the user's time zone, and saved in afterterm's data folder as they change, so a quit and relaunch on the same day carries on counting. A finished day is sent the first time afterterm is running after it ends: just after midnight if it is open (checked every few minutes, so a PC asleep at midnight sends on waking), otherwise at the next launch, however many days later; several waiting days are each sent. Each carries the date it counts, not the moment it was sent. A day whose PC never runs afterterm again is never sent.

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

Phase 1 is AFT-130, Phase 2 AFT-131, Phase 3 AFT-132.

### Every event (Phase 1)

| Field | What it records |
|---|---|
| Install id | A random code for this copy of afterterm, made once on first launch, tied to no account |
| Version | afterterm's version |
| Windows | Windows 10 or 11 and its build number |
| Processor | x64 or ARM |
| Time | When it happened, in UTC |
| Time zone | The user's time zone (for example `America/New_York`) and their local time |
| Country and city | Worked out by PostHog from the address the event came from; the address itself is not kept |

### Opening and time in the app (Phase 1)

| Event | When it is sent | What it records |
|---|---|---|
| App opened | Every start | Why: opened by the user, restarted for an update, or the first launch ever |
| App closed | On quit | How long it ran, and how it closed: by the user, by an update, or by Windows shutting down |
| Time in use | On quit, and once a day | Minutes the window was in front and active, apart from minutes it only sat open |
| Still open today | Once a day while running | Nothing more; counts people who never restart |
| Setup at launch | With App opened | Number of projects and threads, shells installed, Claude Code found, editor found |
| Opened again while running | When afterterm is started while already open | The window's state at that moment: in front, behind other windows, minimised, or on another screen |
| Minimised or restored | On each | Which of the two |
| Screens | With App opened | Number of monitors and the window's size |
| Startup time | With App opened | Seconds from launch until afterterm is usable |
| Time per screen | When leaving a screen | Minutes on Home, the workspace or a project page |

### Keyboard shortcuts (Phase 2)

Each shortcut's presses are counted all day and sent once a day as one event: Ctrl+Shift+T, Ctrl+Shift+P, Ctrl+Shift+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+Down, Ctrl+Shift+Up, Ctrl+Shift+B, Ctrl+Shift+F, Ctrl+Shift+A, Ctrl+Shift+L, Ctrl+Shift+U, Ctrl+C, Ctrl+V, Ctrl and scroll. Never what was copied, pasted or searched. A new shortcut is added to this list.

### Claude activity (Phase 2)

Counted on the user's PC all day and sent once a day as one event, "Claude activity today", so a busy day never means more events (Aryan, 2026-11-17). Every number comes from something afterterm already reads; nothing reads what a message, file or image says.

| Number | Counted from | What it records |
|---|---|---|
| Messages sent to Claude | The count behind Home's streak calendar (`activity-counts.ts`) | How many messages, and the current streak |
| Most chats working at once | The spinner states | The highest number of chats working at the same moment that day |
| Claude working and waiting | The spinner and needs-you states | Minutes Claude worked, and minutes chats waited for the user |
| Files Claude changed | The Files button's reader (`session-files-store.ts`) | How many documents and how many code files, never their names |
| Images pasted | The Files button's reader | How many, never the images |
| Chats in a worktree | The chat's branch and worktree info (`git-info.ts`) | How many chats worked in a worktree, out of all chats that day |
| Compactions | The compacting state | How many times chats compacted |
| Chats resumed | Wake and history | How many, and from where: sleep, an update, or history |
| Subagents started | The Files button's reader, which already reads subagent files | How many |
| How long chats lived | First and last message times | For each chat that ended that day, the time from its first message to its last |

### Projects and Home (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Project created | When a project is made | Its default shell: Command Prompt, PowerShell 7, Windows PowerShell, Git Bash or WSL |
| Project opened | When a project is opened | Where from: Home, the rail, the sidebar, search, or the Other projects list |
| Pinned or unpinned | On each | Which of the two |
| Archived, restored or deleted | On each | Which of the three |
| Project page opened | When a project page opens | Which tab: Live, Asleep or History |
| Project edited | When the Edit dialog is saved | Which parts changed: name, colour, icon, folder or shell |
| Icon and colour chosen | When a project is made or edited | Which of the ten icons, and whether the colour came from the set or the wheel |
| First project button | When Create your first project is clicked | Nothing more |

### Threads (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Thread created | When a thread starts | Chat or shell, which shell, and how: Ctrl+Shift+T, the New thread button, the rail, or a project page |
| Slept or woken | On each | Chat or shell, and how: the Wake button, a menu, or after an update |
| Thread closed | When a thread closes | Chat or shell, and how: Ctrl+Shift+W, the x on its row, or a menu |
| Resumed from history | When a closed chat is reopened | Nothing more |
| Renamed, moved or marked unread | On each | Which of the three |
| Chat finished, needs you or compacting | When Claude's state changes | Which state, and the model family: Opus, Sonnet, Haiku or Fable |
| Time waiting for you | When a chat that needed you is answered | Minutes between Claude asking and the answer |
| Awake threads | Once a day | How many threads are awake and asleep |
| Model switched | When `/model` is used | From which model family to which |
| Time asleep before waking | On wake | Hours the thread was asleep |

### Sidebar, rail and search (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Sidebar hidden or shown | On each | How: Ctrl+Shift+B or the button on the rail |
| Thread switched | When another thread is opened | How: a click in the sidebar, the rail, Ctrl+Tab, or Ctrl+Shift+Up or Down |
| Sidebar resized | When the edge is dragged | Nothing more |
| Dragged in the sidebar | On a drop | A thread or a project, and where: another place, Pinned, or another project |
| Rail tile clicked | On click | Nothing more |
| Sidebar search used | When typing starts | Nothing more; never the text |
| Search palette opened | On open | How: Ctrl+Shift+P or Search on the rail |
| Search palette result opened | When a result is opened | A project, a thread or a closed thread |
| Show more or Show less | On click | Which of the two |
| Collapse all or Expand all | On click | Which of the two |
| Hover card shown | When a card appears | Nothing more |

### Two threads side by side (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Side by side started | On the drop | Nothing more |
| Side by side ended | When it ends | How: Ungroup, a half closed, or a half moved |
| Drop refused | When a drop turns red | Why: another project, or already two |
| Divider dragged | On release | Nothing more |

### Notifications (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Toast shown | When a toast appears | Done, needs you, background or compacting |
| Toast clicked | On click | Which kind |
| Toast went away on its own | After its 5 seconds | Which kind |
| Time from toast to answer | When the chat is answered | Minutes between the toast and the reply |

### Edited files and file links (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Files button opened | On click | Nothing more |
| File link clicked | On click | Kind of file (document, code, image, page) and where it opened: the editor, its own app, or Notepad |
| File link menu used | On a menu item | Open, Open file location or Copy file path |
| File opened from the Files list | On click | Kind of file |
| Image tag clicked | When `[Image #N]` is clicked | Nothing more |

### Servers and the terminal (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Server detected | When a port starts listening | Nothing more; never the port |
| Open localhost clicked | On click | Nothing more |
| Find used | When the find bar opens | Nothing more; never the text |
| Font zoomed | On Ctrl and scroll | Nothing more |
| File dropped in | On a drop | Nothing more |
| Web link clicked | On click | Nothing more; never the address |
| Copy or paste with right-click | Counted all day, sent once a day | Times each was done with the mouse |

### Usage card (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Usage card opened | On open | Which tab, and how: Ctrl+Shift+U or the gauge on the rail |
| Usage card refreshed | On refresh | Nothing more |
| How full the limits are | When the card loads | Each bar in a band: under 50%, 50 to 75%, 75 to 90%, over 90% |
| Usage card failed | When it shows an error | Which error, from a fixed list |

### Loops (Phase 2)

Several of these answer one question: when a loop rots, do people pick it back up, finish it, or drop it?

| Event | When it is sent | What it records |
|---|---|---|
| Loop created | When a loop starts | Feature, bug or idea, and whether Claude or the user started it |
| Loop closed | When a loop closes | Feature, bug or idea, and who closed it |
| Loops card opened | On open | How: Ctrl+Shift+L or the loops button |
| Loops tour | When the tour ends | Finished or skipped |
| Progress column closed | On close | Nothing more |
| Loop changed by hand | On each | Rename, move, archive, delete or restore, and whether the loop was rotting |
| Open chat from a loop | On click | Whether the chat was open, asleep or closed |
| Rotting loops | Once a day | How many loops are open and how many are rotting |
| Loop started rotting | When a loop reaches 5 days untouched | Feature or bug |
| Rotting loops looked at | When the rotting count or filter is clicked | Where: the loops card or Home |
| Rotting loop picked up | The first activity on a rotting loop | What brought it back (its chat opened, its note updated, a ping, a sub-loop added, or work started), who (Claude or the user), and days rotting |
| Rotting loop finished | When a rotting loop is closed as done | Who closed it, and days rotting |
| Rotting loop archived | When a rotting loop is archived | Who, and days rotting |
| Rotting loop deleted | When a rotting loop is deleted | Who, and days rotting |

Archived and deleted are separate events, never counted as one (Aryan, 2026-11-17).

### Updates (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Check for updates clicked | The About window's button | What it found: a new version, up to date, or could not check |
| Update offered | When the title bar button appears | The version offered |
| Update, Later or Skip | On click | Which of the three |
| Download finished or failed | When the download ends | Finished, or why it failed: no network, or the file did not match |
| Restart now | On click | Nothing more |
| Update installed | On the first launch after an update | From which version to which |
| About window or What's new opened | On open | Which of the two |
| Days to update | On the first launch after an update | Days between the update being offered and installed |

### Install (Phase 2)

| Event | When it is sent | What it records |
|---|---|---|
| Claude Code check | On the first launch after installing | Passed, or which check failed, from a fixed list |

### Errors (Phase 3)

| Event | When it is sent | What it records |
|---|---|---|
| Error | When afterterm hits an error | The kind of error and where in afterterm's code; never the message |
| Window crashed or froze and came back | When it recovers | Nothing more |
| Shell failed to start | When a shell does not start | Which shell |
| Notifications not working | When the hook check fails | Which check failed |
| Freezes | When the app stalls for over a second | How long it stalled |
| Memory use | Once a day | Memory afterterm uses, rounded |

## Turned down

Events suggested and turned down, so nobody suggests them again:

- Session recording (2026-11-17): the terminal would show code and secrets, and the rest of the window shows project and thread names.
- Hashed Claude, OpenAI or Codex account ids, and Claude Code's machine id (2026-11-17): installs are counted by afterterm's own random id only.
- A switch in the app to turn analytics off (2026-11-17): the environment variable is the only way, as in T3 Code.
- Token counts per day (2026-11-17, suggested and left out): they show how much each person spends with Anthropic. Not asked for; raise again only if Aryan brings it up.

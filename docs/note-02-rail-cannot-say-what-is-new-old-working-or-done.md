# Note: the rail cannot say what is new, old, being worked on or done, and what would fix it

**Date:** 2026-11-03 · **Status:** diagnosis recorded, no design agreed, nothing built. The matching entry in `docs/bugs.md` is "The rail cannot say what is new, what is old, what is being worked on and what is done" (2026-11-03).

Aryan, 2026-11-03: "I truly feel that side rail is useless right now. I have so many things in the side rail. I am not able to understand what they are just by looking at them. I don't know what is old, what is new, what are the things which I am working on right now, and which are done."

## The short answer

The rail was built as an alert strip for a few projects, and it is being asked a different question: "what is happening across my work right now". It cannot answer that because it has no names, no time, no order and no threads. The four rail entries already in `docs/bugs.md` (2026-10-01 the order is a black box, 2026-10-02 icons and badges have no names or meanings, 2026-10-02 pinned tiles need a divider, 2026-10-08 unread has no indicator and the badges are hard to remember) are symptoms of this one cause. Fixing them one by one would keep the model that fails.

## What the real session looks like

Read from `%APPDATA%\afterterm\session.json` on 2026-11-03:

| | |
|---|---|
| Projects | 25 |
| Threads | 129 |
| Threads awake at that moment | 3 |
| Projects active in the last 3 days | 7 |

The design the rail was agreed against (`docs/design-03-sidebar-and-attention.md`, decision 1, 2026-09-19) used a mock with eight projects, three pinned, and a handful of pending threads. At that scale a column of icons works. At 25 projects with work spread over five to seven of them in a week, the rail becomes the whole panel in miniature with the names removed.

## Why the rail reads as a pile

Each point below is read from the code as it is today.

- **Tiles are projects, not threads.** `railProjects` in `src/renderer/attention.ts` returns groups, and the tile draws counts per project. A tile with "2 finished" cannot say which two threads. Work happens in threads, so the unit the rail shows is one level too coarse.
- **Tiles have no names.** `components/Rail/index.tsx` draws a 20px icon in the project colour and nothing else; the name is only a hover tooltip. In the screenshot `docs/screenshots/manual-testing/16-rail-tiles-and-badges-with-no-names-or-meanings.png` there are three robots and two film strips, told apart only by colour. With 25 projects the icon and colour pair does not identify anything.
- **The order is project creation order.** `railProjects` filters `state.groups` and keeps its order, and `useTabState.ts` only ever appends to that array (`setGroups(prev => [...prev, group])`); activity changes `lastActiveAt` but never moves a group. So a tile that just lit up appears wherever its project was created, never at the top. This is the black box of the 2026-10-01 entry.
- **There is no time at all.** A thread's state is one word, `Tab.notification` in `components/TabBar/types.ts` (`done`, `attention`, `background`, `compacting`, `working`), with no timestamp, and it is not saved across a restart (the 2026-09-29 entry). A thread that finished three days ago and one that finished a minute ago are the same green number. The rail literally cannot know old from new, so it cannot show it.
- **Entries are sticky.** Finished stays until the thread is opened (`handleActivate` in `app.tsx`). Needs-you stays until it is answered (design-03 decision 4). A thread deliberately parked keeps its project on the rail for days. Over a week of parallel work the rail fills with things already decided about.
- **"Working on now" is not on the rail.** An awake shell, a server, or an idle chat mid-way through a piece of work has no badge, so its project has no tile, while a project whose thread finished last Tuesday does. The 2026-10-01 entry "There is no view of the threads that are awake" is the same gap seen from the panel.

So the four things Aryan wants to see map like this:

| Question | What the rail says |
|---|---|
| What is new? | Nothing: no time is recorded |
| What is old? | Nothing: no time is recorded |
| What am I working on now? | Nothing: an awake thread without a badge has no tile |
| What is done? | A green count per project, with no names |

Three of the four are missing by construction, not by a bug in the code.

## What would fix it

The rail should become a list of threads, ordered by when something last happened, split into the three questions Aryan asks, with names and ages. Concretely:

1. **Record a time with every state change** (when `Tab.notification` changes) and save it with the session. Everything else depends on this; today it does not exist.
2. **Rows are threads**, with the project shown as its colour and icon on the row, not as the row itself.
3. **Three groups in a fixed order:** Needs you, Working now (every awake thread, including idle shells and servers), Finished. Each group sorted newest first, each row showing its age ("2m", "3h", "2d").
4. **Old entries leave on their own.** A finished thread older than a day drops off the list without being opened, and a parked needs-you thread can be dismissed from its row.
5. **Names are visible.** A 76px column cannot carry this, so the list either lives at the top of the panel as a "Now" section with the rail keeping one count per group, or the rail grows into a wider strip when it has entries. That width question is the one real choice, and it is Aryan's.

## Next step

By the project's convention, a mock page with that one question (a narrow rail with the list in the panel, or a wider rail that carries the list itself), built on the design-03 shared files with Aryan's real project names and counts, agreed before anything is built. Not started.

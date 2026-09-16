# R2 Holotable

A holographic R2-D2 that reacts, live, to what a Claude Code session is doing.

Claude Code writes a transcript of every session to disk. This reads those
files as they grow and turns them into a room: the droid rolls to a workbench
when a file is read, its dome lights flare when a tool fails, a smaller droid
spawns for every subagent and fades out when it finishes, and when Claude asks
you something the droid stops, turns, and holds the question up on a cone of
light.

None of it is a metaphor for the work — it *is* the work, one event at a time.
The point is a display you can leave running and understand at a glance from
across the room: whether it is working, waiting on you, or stuck.

Needs [Bun](https://bun.sh), built against 1.3.14. Nothing to install: Three.js
is vendored and there are no dependencies.

```
bun run server.ts          # http://127.0.0.1:4242
PORT=8080 bun run server.ts
bun test                   # 63 tests
```

## Watch it run



https://github.com/user-attachments/assets/e0df7448-a8a4-49da-b3ca-47c7202372d8



## What it reads

The server tails the selected `.jsonl` (`fs.watch` plus a 1.2 s safety poll,
because `fs.watch` occasionally falls asleep on macOS) and normalises every line
into a minimal event:

```ts
{ t, kind: "tool"|"result"|"text"|"user"|"system"|"mode"|"title",
  tool?, error?, sidechain?, agent?, atype?, model?, tokens? }
```

That is all the page receives. **Session content never leaves the disk**: no
prompts, no tool output, no diffs. Only the shape of what happens.

`/api/stream` rejects any path outside `~/.claude/projects` with a 403.

## Watching from another device

```
bun run lan                # or: bun run server.ts --lan
```

The server prints the address other devices should use, picking the private
LAN interface over any VPN or tunnel that also reports one:

```
  listening on   http://localhost:4242
  on this network http://192.168.1.17:4242
  ⚠ anyone who can reach this port can read your session
    names, tools and costs. There is no password.
```

That warning is the whole story: there is no authentication, so on a network
you do not control this is the wrong thing to run. `HOST=0.0.0.0` does the same
as `--lan` if you prefer the environment variable.

**F** toggles fullscreen, which is what you want on the spare screen this ends
up on.

## Security and privacy

There is no authentication, so the server binds to `127.0.0.1` unless you ask
otherwise: on a shared network nobody else can reach it. `--lan` (or
`HOST=0.0.0.0`) opens it up and warns at startup; past that point anyone who can
reach the port gets everything below.

Even with the content staying on disk, the page still exposes:

- project paths and session titles — a folder called `~/work/layoffs-q3` shows
  up in the dropdown under that name
- which tools ran, when, and which ones failed
- model names, token counts and cost, where the transcript records them

Never read or sent: prompt text, tool output, file contents, diffs.

The session picker is the part to cover if you screen-share: it lists the name
of every recent project.

### Subagents write somewhere else

This is the part that is easy to get wrong. A session running subagents writes
almost nothing into the parent transcript: the parent gets the `Task` line when
a subagent starts and the `tool_result` when it finishes, while every tool the
subagent actually calls lands in

```
<session-id>/subagents/agent-<id>.jsonl
```

Measured on a live session: in six seconds the parent grew by 606 bytes and the
three active subagents by 17,800. Watching only the parent means seeing about 3%
of the work. So the server follows the parent **and** the whole `subagents`
directory, rescanning every 5 s to pick up agents that spawn mid-session.

## Questions

`AskUserQuestion` and `ExitPlanMode` are the two tools that wait on a human. The
droid that called one stops, turns to face you and holds up a plate on a cone of
light: a question bar, a few option rows, a caret walking them. It flickers and
drops out on purpose — a steady rectangle reads as a label stuck on the screen
rather than something being projected.

The plate carries no text. The wording stays on disk like everything else, so
what you get is that there is a question, not what it asks.

Only the asking droid stops. The rest of the bay keeps working, and that
contrast is the whole point: one unit standing still among moving ones is easy
to spot.

## The room

**Room** puts every session that is currently working into the same bay at
once, instead of showing one and cycling. The session you were already
watching keeps the full-size droid and the readouts; the others each get their
own droid on the floor, labelled with their project. Subagents of those
sessions collapse into their parent droid — showing everyone's helpers would
crowd the floor past reading.

It is one connection, not one per session. Browsers cap HTTP/1.1 at six
connections per origin, so a stream each would silently stop opening around
the seventh with nothing in the console to say why. `/api/stream` takes
repeated `path=` parameters and tags every event with the session it came
from; a single session behaves exactly as it did before. The server caps a
request at `MAX_SESSIONS` (8) because each one costs two file watchers.

Room and Rotate are alternatives: rotating exists for when you can only see
one session, and the room is the reason you no longer have to. Turning either
on turns the other off.

## The pulse ring

A thin ring of ticks around the rim of the floor, one per slot of recent
history, brighter where events clustered and red where they failed. It is the
shape of the last stretch of work, readable without looking away from the
droid.

Its span is measured rather than chosen, and that took three tries — each
failure is recorded in the comment above `bucketize()` and in
`tests/ring.test.ts`, because none of them throw, they just draw an empty
ring. A fixed 12-hour window came back 3/60 slots full on live sessions. The
backlog is capped at 220 events, so a busy session spends them in minutes
while a quiet one spreads them over days. What works is to take the last 120
events and let them set their own scale: the ring fills either way, and the
span is what differs.

## On a wall

**Rotate** cycles the sessions that are actually doing something: anything whose
newest activity — parent or subagent — is under a minute old. It moves on every
4 seconds and the button shows how many are in the rotation, so an idle machine
settles on the one session still working rather than flicking through forty dead
ones. The session being watched is named under the title, large enough to read
from across a room.

Two clocks, deliberately: the fetch keeps the candidate list fresh every 10 s
while rotating, and the rotation itself ticks every second off the last list it
was handed. Tying them together capped switching at the poll interval, which is
what made an early version look stuck.

The only things that hold a switch are an open question and your own use of the
page — replay or recording. Talking does not: a busy session emits prose
continuously, and waiting on that meant the rotation almost never fired.
`tests/rotate.test.ts` pins the activity window, including the case where a
missing timestamp must read as quiet rather than as now.

With **F** for fullscreen and `bun run lan` for a screen on another machine,
that is the whole wall-display setup.

## Replay and recording

**Replay** puts a transport over everything the page has received since it
connected: drag the scrubber, or play it back at 1× to 8×. The stream keeps
arriving and keeps being recorded while you are in the past, so **Live** returns
to a current world rather than a stale one.

Scrubbing rebuilds instead of rewinding. The state is cumulative — tokens,
counters, which droids exist — and `handle()` has no inverse, so the page resets
and re-applies history up to the instant you picked. `histCount()` decides where
that cut falls, and `tests/replay.test.ts` covers it: an off-by-one there throws
nothing, it just replays a world that is one event wrong.

**Record** captures the canvas with `MediaRecorder` and hands you the file when
you stop. The container is whatever the browser supports, webm in most and mp4
on recent Safari. It records in real time, so the way to get a short video of a
long session is to record a replay at 4×.

## Module mapping

Every subsystem is a documented piece of R2-series equipment, mapped to the kind
of work it resembles — not an arbitrary assignment.

| Module | Equipment | Fires on |
|--------|-----------|----------|
| SNS | 360° dome video sensor | Read, Grep, Glob, LS |
| SCP | retractable scomp link arm | Bash, BashOutput, KillShell |
| MAN | fine manipulator (micrometer) | Write, Edit, MultiEdit, NotebookEdit |
| TRX | full-spectrum transceiver | WebSearch, WebFetch, `mcp__*` tools |
| VCK | VicksVisc holographic projector | Task and subagent lines |
| EXT | onboard fire extinguisher | `tool_result` with `is_error` |
| INT | Intellex IV computer | model prose, token count |
| LOC | retractable third leg | human turns, session activity |

The dome turns on reads and snaps back to centre when you take a turn. The third
leg deploys while the session works and folds away after 20 s of silence.

## The fleet

Each live subagent gets its own droid, and the **series comes from the model**
behind its events:

| Model | Series | Head |
|-------|--------|------|
| opus | R2 | hemispherical dome |
| sonnet | R4 | conical dome |
| haiku | R5 | short cone head |

The head shapes are canon: the R4 is identical to the R2 except for its conical
dome, and the R5 has a shorter cone head and was the cut-price, unreliable unit.
The size difference encodes the model tier and is a reading aid, not a canonical
dimension.

Droids fade out after 60 s of silence. On connect, a subagent is only given a
droid if it was still active near the end of the replayed backlog — otherwise
every subagent that ever ran would materialise at once.

### Nesting is inferred

The transcript gives each subagent an `agentId` and an `attributionAgent`, but
the latter is the agent **type** (`general-purpose`, `fork`) — there is no parent
id anywhere in the format. So when a subagent calls `Task` and a new agent file
appears shortly after, the page attaches that droid to it as a child, places it
in orbit around its parent and tethers it there. It is a timing heuristic, and
the Info panel says so.

## Colour channels

- **cyan** — the projection itself
- **green** — logic-display blip, a clean `tool_result`
- **red** — logic-display blip, a failed one
- **amber** — whole-body alarm, the extinguisher firing

## Layout

```
server.ts              compat entry, re-exports server/index.ts
server/index.ts        HTTP routes
server/config.ts       host, port, paths, tuning constants
server/sessions.ts     session discovery and description
server/stream.ts       SSE endpoint, transcript tailing
server/transcript.ts   JSONL parsing and event normalisation
server/subagents.ts    subagent file conventions
server/fsutil.ts       bounded reads
shared/protocol.json   the wire contract; server/types.ts mirrors it
shared/systems.json    R2 subsystem definitions
public/index.html      layout, palette, info modal
public/holotable.js    procedural model, rig, reactions
public/three.min.js    r128, served locally (no CDN)
tests/                 contract, normalisation, escaping, guards,
                       replay, rotate, multiplex, ring
```

Splitting the wire format across two files invites them to drift apart, so
`tests/contract.test.ts` fails when they do.

Three.js is vendored, so the page works offline. The only external load is
Google Fonts, and the system fallback stack holds up fine without it.

## Troubleshooting

- **Empty session list** — nothing in `~/.claude/projects` yet, or every
  transcript is under 1 KB (aborted sessions are skipped).
- **`EADDRINUSE`** — the port is taken: `PORT=8080 bun run server.ts`.
- **Blank stage, no droid** — no WebGL. Check `chrome://gpu`, or whether
  hardware acceleration is switched off.
- **Nothing on another device** — it only listens on localhost, see above.

## Appendix: stills

<img width="1641" height="837" alt="The bay, with the primary droid at a workshop station" src="https://github.com/user-attachments/assets/d214c2d4-041c-45d1-ad9b-a27f06c9e7a2" />

<img width="1641" height="837" alt="Subagent droids on the floor" src="https://github.com/user-attachments/assets/161c56b8-7ab9-4e37-be81-370d6eb71853" />

<img width="1641" height="837" alt="The workshop floor and the column" src="https://github.com/user-attachments/assets/c3db44ce-52d3-4905-aedc-f383dfdb7219" />

## Licence

MIT — see [LICENSE](LICENSE). Three.js r128 is vendored in
`public/three.min.js`, © 2010-2021 Three.js Authors, also MIT.

## Notes

Two Three.js footguns are worth knowing, because both cost real debugging time
here and both are silent:

- `renderer.setSize(w, h, false)` updates the drawing buffer but not the CSS
  size. On a Retina display the canvas ends up twice the size of its stage and
  you see only the top-left quadrant.
- `clock.getElapsedTime()` consumes the delta internally, so a `getDelta()`
  called *after* it returns ~0 and everything time-based silently freezes.

The geometry is a procedural reconstruction from published specifications and
the known silhouette, not a scale survey. Star Wars and its droids are the
property of Lucasfilm Ltd; this is an unofficial fan project, unaffiliated.

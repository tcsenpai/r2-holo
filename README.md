# R2 Holotable

A holographic R2-D2 that reacts, live, to what a Claude Code session is doing.

```
bun run server.ts          # http://localhost:4242
PORT=8080 bun run server.ts
```

The dropdown lists the 40 most recently active sessions from `~/.claude/projects`,
with the title and cwd read out of each transcript rather than decoded from the
folder name (which is ambiguous for paths like `poppix-lineareact`). The list
refreshes every 30 seconds, so a session that wakes up climbs back to the top.

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
server.ts              session index + SSE
public/index.html      layout, palette, info modal
public/holotable.js    procedural model, rig, reactions
public/three.min.js    r128, served locally (no CDN)
```

Three.js is vendored, so the page works offline. The only external load is
Google Fonts, and the system fallback stack holds up fine without it.

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
property of Lucasfilm Ltd.

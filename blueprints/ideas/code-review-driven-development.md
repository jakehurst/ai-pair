# Code-Review-Driven Development

A gate and a lock on top of AI pair programming.

## The idea in one paragraph

Most AI coding today works like a mail-order service: you write a detailed
spec, the agent goes away, and it comes back with a large block of finished
code that you're supposed to review all at once. But reviewing a thousand
lines that already depend on each other isn't really reviewing. You can't
reject one part without unraveling everything built on top of it, so review
quietly turns into skim-and-trust. Pair programming tools such as
[ai-pair](https://github.com/faiface/ai-pair) fix the first half of this: the
agent types in your editor at a human pace, narrates as it goes, and you can
interrupt it at any keystroke. What they do not fix is the second half.
Watching code appear is not the same as agreeing to it. Code-review-driven
development adds the missing step: after each small piece, the human decides,
and once a piece is accepted it is locked. Nothing becomes permanent until a
person has actually looked at it and agreed, and nothing agreed to is
quietly reopened.

## What ai-pair already provides

This document builds on ai-pair as it exists today, and keeps all of it. The
parts that matter here, each verified against its protocol and source:

- **Pace.** The agent submits small batches of actions (say, move, select,
  type, delete, point, run). The editor plays them slowly enough to follow,
  with pauses after moves and selections and a reading pause after each
  message. A speed menu scales everything from 0.4x to 3x.
- **Batches.** A batch is one idea: usually one `say` and the few edits it
  describes. The agent is never more than one batch ahead. It plans the next
  batch while the current one plays, and `step` returns a report of what
  actually happened, including the code as it now stands.
- **Interruption.** Anything the programmer does preempts the agent. A
  message, an edit, or the Interrupt button stops playback, discards the
  queued batches, and the agent learns exactly what happened in its next
  report. A batch planned without knowledge of an interruption never plays.
- **Two seats.** "My turn" hands the keyboard to the programmer; the agent
  becomes the navigator and comments only when useful. "Hand back" returns
  it.
- **Narration.** The agent says what it is about to do and why, close to the
  lines it describes, before they appear. The programmer should always be
  able to answer "where is this going?" and "what just became real?"
- **Visible commands.** Tests and builds the agent runs appear in a terminal
  and wait for Run, Allow for session, or Skip.
- **Follow mode and the report.** The view follows the agent's cursor, and
  every report shows the resulting code with the cursor marked, so the agent
  sees what the programmer sees.

None of this is changed. The pacing, the batch mechanics, the interrupt
semantics, and the narration rules stay exactly as ai-pair defines them.

## What is missing: the decision

In ai-pair, a batch's edits are applied to the file as they play and the file
is saved when the batch ends. Silence is consent. If the programmer does
nothing, the next batch plays, and the code the last batch typed is now
simply part of the file, indistinguishable from code that was looked at and
agreed to.

The programmer has four moves and all of them are forms of interruption:
say something, edit the code, press Interrupt, or take the keyboard. There is
no move that means "yes, this piece, as written." And because there is no
accept, there is no boundary: the agent is free to edit code it typed ten
batches ago, and the programmer has no record of which pieces they actually
checked.

Two things are missing, and they are the whole of this document:

1. **A gate.** An explicit decision on each piece, made by the human, before
   the next piece plays.
2. **A lock.** Once accepted, a piece is frozen. It becomes a fixed point
   that later work builds on and is reviewed against.

## Blocks, and who draws the boundary

A **block** is the unit that passes through the gate: one small,
self-contained change that the reviewer can hold in their head at once. In
ai-pair terms, a block is one or more consecutive batches.

The agent proposes block boundaries, since it knows where an idea ends. By
default, every batch end is a proposed boundary. But the human owns the
boundary, in both directions:

- **Cut it shorter.** At any point during playback: *"stop here, this is a
  block."* Playback pauses at the end of the current action, and what has
  been typed so far is the block on the table.
- **Let it run longer.** The human can tell the agent that the next several
  batches form one block, or accept several batches at once when the pieces
  only make sense together.

Block size is set by how much a person can actually take in, not by line
count or by the agent's guess. The human is the one whose attention is the
real limit, so the human draws the line.

## The gate

When a block finishes playing, playback stops. The block is on the table and
nothing else happens until the reviewer decides. The agent, which under
ai-pair's rules has been planning the next batch while this one played, holds
that batch until the decision arrives.

### Explain after the code

ai-pair's narration rule stands: the agent says what it is about to do and
why before the lines appear, so the programmer is never watching code arrive
blind. The gate adds a second, different kind of explanation, at a different
time. Once the block is fully on screen, the agent gives its **argument for
the block as written**: why this approach, what it chose not to do, what it
is unsure of. This comes *after* the code, never before, and it is separate
from the running narration.

The ordering matters. The reviewer should judge the code on its own first,
then hear the argument for it. If the argument comes first, it steers the
reviewer toward agreement before they've formed their own read. Narration
before the code tells you where the agent is going; the argument after the
code tells you whether it got there, and that one you should read with your
own opinion already formed.

### The four decisions

The reviewer does exactly one of four things:

| Decision | Meaning | In ai-pair terms |
|---|---|---|
| **Accept** | The block is good as written. | New. Marks the block's edits as accepted and locks them. The held batch plays. |
| **Amend** | The block is close; change it in a specified way. | Existing mechanics: the programmer edits the code themselves, or sends a message saying what to change. The agent revises the same block. The block stays on the table until accepted. |
| **Reject** | The block is wrong; discard it. | New as a single action: the block's edits are undone back to the state at its start. ai-pair already places an undo stop at each action's boundary, so the editor has the points it needs. The agent is told, with the reason, and proposes a different block. |
| **Redirect** | Stop and take the work in a different direction. | Existing mechanics: an interrupt with a message. The block on the table is rejected, and the direction changes. |

Accept is the only decision that moves code from "on the table" to
"permanent." Amend and reject keep the block open or remove it. Redirect ends
the block and changes what comes next.

Nothing that ai-pair already supports is removed. The programmer can still
interrupt mid-block, edit at any time, or take the keyboard. Those moves
become ways of amending or redirecting the block on the table, rather than
moves with no recorded outcome.

### The gate during the programmer's turn

The gate applies to both seats. When the programmer is typing and the agent
is navigating, the programmer declares block boundaries in their own work
("that's a block, review it") and the agent takes the reviewer seat: it gives
its read of the block, and the programmer decides whether to accept it into
the record. The rule never changes: **no code becomes permanent until the
participant in the reviewer seat has looked at it and agreed.** Review is not
something one party does to the other. It is the gate every piece passes
through, regardless of who wrote it.

## The lock

When a block is accepted, it is frozen. Its lines are a fixed point that
everything after it is built on and reviewed against. The agent cannot edit
them.

This is enforced by the editor, not by asking the agent nicely. ai-pair
already rejects a batch whose `move` targets a line the agent has not been
shown, with a `line_not_seen` error that tells it where the line is now. The
lock works the same way: a batch whose `type`, `delete`, or `select` target
falls inside an accepted block is rejected before it plays, with a `locked`
error naming the block. The agent sees the rejection in its report, the way
it sees any rejected batch today, and nothing reaches the screen.

To change accepted code, the agent asks. It says what it wants to change and
why, and calls `listen`. The human either **unlocks** the block, which
reopens it as a block on the table to be amended and accepted again, or
refuses. Unlocking is deliberate and visible. It is the human's act, never
the agent's.

The programmer's own edits to accepted code are not blocked, since the
editor is theirs. But an edit inside an accepted block reopens that block:
it goes back on the table and must be accepted again. The record never
claims that a region is accepted when its text has changed since.

This single rule does a lot of quiet work:

**It stops drift.** The agent can't slowly reinterpret something you settled
earlier, because settled blocks don't move. A later batch has to build on
the accepted signature, type, or structure exactly as agreed.

**It makes "keep going" simple.** After an amend or reject, only the current
block changes. Everything already accepted stays exactly as it is. There's no
risk of the agent rewriting work you already approved, because approved work
is off-limits by construction. The only thing that's ever editable by the
agent is the piece currently on the table.

**It makes interruption cheaper.** In ai-pair, an interruption discards the
queued batches and the agent re-plans from the report. With the lock, the
agent re-plans from a smaller surface: the accepted blocks are fixed, so the
only question is what to do with the block on the table and what comes next.

## The record

The sequence of accepted blocks is, all at once, the finished code, the
history of what was built, and the proof that each piece was actually looked
at and agreed to.

Each entry in the record holds:

- the block's diff, as accepted;
- the agent's narration while it played and its argument after it;
- the decision, with the reviewer's words if any, and every amend and
  reject that preceded the accept;
- who was in which seat.

ai-pair's history panel already keeps the agent's messages, the programmer's
replies, commands and their exit codes, and turn changes, as a transcript.
The record is that transcript with decisions in it and block boundaries
drawn through it. The difference is what it can answer. A transcript tells
you what was said. The record tells you what was agreed, in what order, and
what each agreement was built on.

A spec tells you what someone *intended*. The record tells you what was
actually written down, checked, and agreed to, one piece at a time. You don't
keep a separate design document and a separate review log; the accepted
record is both.

## When to stop and hand back

The model is working when both participants share the same picture of what's
being built and the human can genuinely keep up with the gate. It has broken
down, and should pause or reset, when any of these happen:

**The pictures diverge.** The human and the agent no longer agree on what the
code is supposed to be doing. Stop and re-establish the shared picture before
writing more.

**The human is rubber-stamping.** If blocks are being accepted without real
scrutiny, because they're coming too fast, or they're too large, or the human
is tired, the gate has stopped being real. Slow the playback, shrink the
blocks, or take a break. Accepting without reviewing is the one failure this
whole model exists to prevent, and it is the failure ai-pair alone cannot
detect, since in ai-pair silence and attention look the same.

**The work outgrows the human's model.** If the code has grown past what the
human is still holding in their head, the "design lives in a person's head"
assumption no longer holds. Stop and either write things down or narrow the
scope. The record helps here: it is the written-down version, and re-reading
accepted blocks in order is how the human rebuilds the picture.

**A redirect can't be cleanly absorbed.** If the human's steer can't be
reconciled with the accepted record without unlocking accepted blocks, the
direction changed more than the loop can handle in stride. Stop and re-plan
rather than forcing it. Unlocking one block to amend it is normal. Unlocking
five to make a redirect fit is a sign that the redirect is really a new
design.

## What this asks of ai-pair

The additions, stated against ai-pair's protocol so they can be built rather
than argued about:

| Addition | Where it lands |
|---|---|
| A block boundary the human can declare during playback ("stop here") and the agent can propose (default: each batch end) | A `block` marker in the batch, and a panel control that cuts the current block |
| Playback holds at a block boundary until a decision | The controller holds the next `step` instead of playing it |
| Accept, Amend, Reject, Redirect as panel controls, and as a `decision` event in the report | A new `Event` kind alongside `message`, `edit`, `interrupt`, `turn`, and `end` |
| Reject undoes the block's edits to the state at its start | Uses the undo stops ai-pair already places at action boundaries |
| Accepted ranges are locked against agent edits | A `locked` rejection, checked in the same rehearsal pass that produces `line_not_seen` |
| Unlock is a human action that returns a block to the table | A panel control and a `decision` event with kind `unlock` |
| The agent's argument for the block, after it plays | A `say` tagged as the block's argument, shown at the gate rather than during playback |
| The record | The history panel, with block boundaries and decisions, exportable as the session's review log |

Everything else ai-pair does is left alone.

## What you get

A way of working with an agent where the human stays in the reasoning the
whole time instead of only at the end, and where staying in the reasoning
leaves a mark. ai-pair gives you the pace and the ability to interrupt. The
gate makes each piece a decision rather than a thing that happened while you
were watching. The lock makes that decision hold. And the trail of small,
agreed-upon pieces is a better record than a spec, because a spec tells you
what someone meant, while the record tells you what was looked at, agreed to,
and built on.

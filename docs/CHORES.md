# Chores

Each agent's transcript tells the server what the session is doing right now. The server boils that down to a **status** and an **activity**; the browser turns the activity into a **chore** and sends the character to a matching **station** in the house.

## Status

| Status | When | What you see |
| --- | --- | --- |
| `working` | A tool call is in flight (Read, Edit, Bash, …) | The character walks to a station and does a chore |
| `thinking` | The model is generating a reply (your prompt or a tool result was the last event) | The character stays put with a "…" thought bubble and a head scratch. It does not walk |
| `idle` | The turn ended and Claude Code is waiting for you | The character rests: sits on a sofa, sips coffee on the porch, or waters a plant |
| `idle` for 8+ minutes | Still waiting for you | The character finds a bed and naps (Zzz) |
| `gone` | No transcript activity for `PA_IDLE_TIMEOUT_MIN` (default 20 min) | The character walks out the front door and disappears |

**Idle is a hard rule.** An idle agent never plays a chore animation. If you click a resting character the panel says idle, and the character looks idle.

## Activity → chore

| Activity | Tools | Chores it can pick |
| --- | --- | --- |
| `read` | Read, Grep, Glob, LS, NotebookRead, ToolSearch | desk, read, bookshelf, mail, pantry |
| `write` | Edit, Write, MultiEdit, NotebookEdit | cook, chop, grill, workbench, fold, make bed, dishes |
| `bash` | Bash and other shell tools | mow, trash, wash car, fix, laundry, vacuum, rake, dishes, scrub, workbench |
| `web` | WebSearch, WebFetch, Chrome browser tools | tv, phone, pool, desk |
| `agent` | Agent, Task, Workflow (spawning helpers) | helper, water |
| `think` | none, the model is generating | stays where it is |
| `idle` | none, waiting for you | sit, coffee, water; nap after 8 min |
| `error` | last tool result was an error (shown for up to 20 s) | an "oops" bubble at the current spot |

## Chore → station

| Chore | Where | Looks like |
| --- | --- | --- |
| desk | desk with computer (den, bedrooms) | typing |
| read | armchair, sofa, bench, bed edge | book in hand |
| bookshelf | bookshelves | browsing the shelf |
| mail | mailbox by the street | flipping through letters |
| pantry | pantry shelves | checking groceries |
| cook | stove | pan and steam |
| chop | kitchen island or counter | knife on board |
| grill | patio grill | tongs and smoke |
| workbench | garage workbench | hammer sparks |
| fold | dryer, walk-in closet | folding clothes |
| makebed | any bed | fluffing the bed |
| dishes | kitchen sink | bubbles |
| mow | front yard, back yard | pushes a mower along rows |
| rake | back yard | raking leaves |
| trash | trash and recycling bins | trash bag |
| washcar | car in the driveway | sponge and suds |
| fix | furnace, water heater, mech room | wrench |
| laundry | washer | loading the drum |
| vacuum | rugs | back-and-forth passes |
| scrub | toilet, tub, vanity | spray bottle |
| tv | sofa facing the TV, rec-room sectional | remote, TV glow |
| phone | armchair, bed, beanbag | phone in hand |
| pool | pool table | cue |
| water | flower beds, plants | watering can |
| coffee | island stool, patio table, porch | coffee cup |
| sit | sofa, bench, patio chair, beanbag | just resting |
| nap | any bed | Zzz |
| helper | porch or mailbox | calling for help; subagents arrive as smaller characters |

## Picking a station

1. A free station for the chore on the agent's current floor.
2. A free station on the other floor, reached via the stairs.
3. Otherwise the nearest station even if someone is already there.

An agent keeps its station while its activity stays in the same chore group. It only moves when the server reports a different activity that has been stable for about 2.5 seconds, so a burst of Read → Edit → Read does not make it run around.

Because main-floor stations are taken first, the upper floor fills up naturally when many sessions are busy, and it appears on screen as soon as one agent is up there.

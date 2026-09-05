# Pixel Agents House — architecture & module contracts

A standalone web app that shows every live Claude Code session as a pixel-art
character living in a house (Greenville 4868B plan, two floors). No build step:
a small Node server + vanilla ES-module front end rendered on `<canvas>`.

```
server/index.js      HTTP (static + /api) + WebSocket, binds 0.0.0.0, prints LAN URLs
server/sessions.js   watches ~/.claude/projects/**/*.jsonl, derives AgentInfo per session
server/demo.js       fake sessions for testing (npm run demo)
public/index.html    shell, UI chrome (light theme, Inter/system-ui)
public/css/app.css
public/js/main.js    boot: load floorplan, connect WS, run loop
public/js/net.js     WebSocket client with reconnect -> emits snapshot/update
public/js/world.js   floorplan -> per-floor grid, walls, doors, stations, A* pathfinding
public/js/sprites.js all procedural pixel art (characters, furniture, floors, walls, props, fx)
public/js/agents.js  Agent entity: chore assignment, state machine, movement, animation timers
public/js/renderer.js layout of floors on screen, scale-to-fit, offscreen caching, day/night
public/js/ui.js      top bar, roster, details panel, selection, fullscreen, kiosk, floor toggle
house/floorplan.json the house (world coordinates, see below)
tools/plan-source.mjs authoring script that generated rooms/doors in floorplan.json
```

## Coordinates

* Tile = 16 px in "world pixels". 1 tile ≈ 2 ft.
* Each floor is a 43 × 26 tile grid, world coords: x → right, y → down.
* The plan was rotated 90° CCW from the architect's drawing: backyard/patio on
  the LEFT of the screen, street on the RIGHT, garage at the BOTTOM, den /
  bedrooms at the TOP.
* World pixel position of tile (x, y): px = x*16, py = y*16. Agents stand with
  their feet at the bottom-center of a tile.
* Facing values: `"up" | "down" | "left" | "right"`.

## floorplan.json

```jsonc
{
  "name": "Greenville 4868B", "tile": 16, "width": 43, "height": 26, "feetPerTile": 2,
  "floors": [
    {
      "id": "main", "name": "Main Floor",
      "outside": "lawn",          // texture for tiles not in any room: "lawn" (walkable) | "roof" (not walkable)
      "rooms": [ { "id": "kitchen", "name": "Kitchen", "kind": "indoor|outdoor|void",
                   "floor": "wood|tile|carpet|concrete|pavers|lawn|asphalt|void",
                   "stairs": false, "rects": [ {"x":14,"y":10,"w":7,"h":8} ] } ],
      "open": [["family","dining"]],      // room pairs with NO wall between them
      "doors": [ { "a":[x,y], "b":[x,y], "kind":"door|double|slider|garage|opening" } ], // a,b adjacent cells
      "stairTransfer": [17, 6],   // walking onto this cell moves the agent to the other floor's stairTransfer
      "spawn": [41, 11],          // main floor only: where agents appear/leave (on the sidewalk)
      "frontDoor": [34, 11],      // main floor only
      "furniture": [ { "type": "sofa", "x": 8, "y": 3, "w": 3, "h": 1, "facing": "down", "solid": true } ],
      "stations": [ { "id": "sofa1", "chore": "tv", "x": 8, "y": 3, "facing": "down",
                      "area": {"x":..,"y":..,"w":..,"h":..} } ]   // area only for mow/vacuum/rake
    }
  ]
}
```

Rules derived by `world.js`:
* Cell → room lookup: later rooms in the list win overlaps. Cells in no room get
  the floor's `outside` texture. `void` rooms and `roof` outside are NOT walkable.
* Wall exists on an edge between two cells if their room ids differ, unless the
  pair is listed in `open`, both rooms are `kind: "outdoor"` (or outside lawn),
  or a door covers that edge. Doors between an indoor room and outdoors are real
  doors (drawn with a frame). `opening` kind draws no door leaf, just a gap.
* Furniture with `solid !== false` blocks its tiles. Stations must be on a
  walkable, non-solid tile. Types `rug`, `mat`, `doormat` default to non-solid.
* Stairs: each floor has ONE `stairTransfer` cell inside its stairs room. A path
  request across floors = A* to own transfer cell, hop, A* from other transfer.

## Furniture vocabulary (drawn by sprites.js `drawFurniture(ctx, item, tick)`)

Item `{type,x,y,w,h,facing}`; `w`,`h` default to the type's natural size. All
positions are tiles; draw at (x*16, y*16). Furniture that agents "sit on"
(sofa, armchair, chair, bed, bench, beanbag, stool) is drawn in two passes:
`drawFurniture(...)` for the base, and `drawFurnitureFront(...)` for a top strip
that should overlap the agent (e.g. sofa arm / blanket). If unsure, draw nothing in Front.

Types (natural w×h in tiles):
kitchen: counter(1×1, tileable), stove(1×1), sink(1×1), fridge(1×1), island(w×1), dishwasher(1×1), microwave(1×1)
dining: table(3×2), chair(1×1 + facing), stool(1×1)
living: sofa(3×1 + facing), loveseat(2×1), armchair(1×1 + facing), coffee_table(2×1), tv(2×1, on wall), tv_stand(2×1), fireplace(1×2), bookshelf(1×1 or 2×1), plant(1×1), lamp(1×1), rug(w×h, non-solid), painting(1×1 on wall)
bedroom: bed_king(3×3), bed_queen(2×3), bed_single(2×3) (facing = head side), nightstand(1×1), dresser(2×1), wardrobe(1×1), desk(2×1 + facing), office_chair(1×1), computer(1×1 on desk, drawn with desk), crib? no.
bath: toilet(1×1), vanity(1×1 or 2×1), tub(2×1), shower(1×1), towel_rack(1×1), mirror(1×1 on wall)
utility: washer(1×1), dryer(1×1), laundry_basket(1×1), shelves(1×1 tileable), bench(2×1), coat_rack(1×1), furnace(1×1), water_heater(1×1), closet(w×1), boxes(1×1)
garage/outdoor: car(2×4 or 4×2 by facing), workbench(2×1), toolwall(2×1 on wall), trash_bin(1×1), recycle_bin(1×1), mower(1×1), bike(1×1), grill(1×1), patio_chair(1×1), patio_table(1×1), tree(2×2 canopy, trunk on bottom-center tile solid), bush(1×1), flowerbed(w×1), mailbox(1×1), fence(1×1 tileable), stairs(w×h + facing = direction of "up"), railing(w×1 or 1×h), pool_table(3×2), beanbag(1×1), doormat(1×1), hoops? no.

`sprites.js` must tolerate unknown types (draw a labelled gray box, never throw).

## Chores and activity mapping

Server reports `activity` per agent; the client maps activity → chore → station.

activity (server) | meaning
--- | ---
`read`  | Read / Grep / Glob / LS / NotebookRead / ToolSearch / WebFetch?no→web
`write` | Edit / Write / MultiEdit / NotebookEdit
`bash`  | Bash / shell-like tools
`web`   | WebSearch / WebFetch / browser (mcp__claude-in-chrome__*)
`agent` | Agent / Task / Workflow (spawning helpers)
`think` | model is generating (user prompt or tool result was the last event, no pending tool)
`idle`  | turn ended, waiting for the user
`error` | last tool result was an error (transient, ≤ 20 s)

chore (client) | stations (type of furniture they belong to) | activity that uses it
--- | --- | ---
`desk` | desk+computer (den, bedrooms) | read, web
`read` | armchair, sofa (with book), bench, bed sitting | read
`bookshelf` | bookshelf | read
`mail` | mailbox | read
`pantry` | pantry shelves | read
`cook` | stove | write
`chop` | island / counter | write
`grill` | grill | write
`workbench` | workbench | write, bash
`fold` | dryer / wic closet | write
`makebed` | bed | write
`mow` | lawn area (station.area) — agent sweeps rows with a mower | bash
`rake` | backyard area | bash
`trash` | trash_bin / recycle_bin | bash
`washcar` | car in driveway | bash
`fix` | furnace / water_heater / mech | bash
`laundry` | washer | bash
`vacuum` | rug area (station.area) | bash
`dishes` | sink | bash, write
`scrub` | toilet / tub / vanity | bash
`tv` | sofa facing tv, rec room sectional | web
`phone` | armchair / bed / beanbag | web
`pool` | pool_table | web
`water` | flowerbed / plant | idle-ish, also `agent`
`coffee` | island stool / patio_table / porch | idle
`sit` | sofa, bench, patio_chair, beanbag — NO activity, just resting | idle
`nap` | any bed — Zzz | idle for > 8 min (client decides from lastActivityAt)
`helper` | (agent activity) the agent walks to the porch/mailbox and "calls for help" | agent

**IDLE IS A HARD RULE**: an agent whose status is `idle` must visibly rest
(sit/coffee/nap). It never plays a chore animation. `think` keeps the agent at
its current spot with a thought-bubble "…" and a small head-scratch idle
animation; it does not walk.

Station selection: prefer a free station on the agent's current floor, then any
free station on the other floor (walk via stairs), then the nearest station
even if occupied. Once at a station, the agent keeps it while the activity's
chore group stays the same; the chore only changes when the server-reported
activity changes and has been stable for 2.5 s (debounce to avoid thrash).

Floors: the upper floor is *rendered* only when at least one agent is on it or
the user forces it (keys `1` main only, `2` both, `0` auto). Because stations
are picked main-floor-first, the upper floor naturally appears when the main
floor stations for the needed chores are all taken.

## WebSocket protocol (server → client, JSON text frames)

```jsonc
{ "type": "hello", "serverTime": 1725000000000, "config": { "idleTimeoutMin": 20, "napAfterMin": 8, "demo": false } }
{ "type": "snapshot", "ts": ..., "agents": [ AgentInfo, ... ] }
{ "type": "update",   "ts": ..., "agents": [ AgentInfo (full objects, changed only) ], "removed": ["id", ...] }
```
Client → server: `{ "type": "ping" }` every 25 s (server replies `{ "type": "pong" }`).

AgentInfo:
```jsonc
{
  "id": "7086b60e-...",           // session id (subagents: "<sessionId>/<agentId>")
  "parentId": null,               // set for subagents
  "isSubagent": false,
  "name": "Mochi",                // deterministic from a fun-name list, hashed by id; stable across restarts
  "project": "pixelagents",       // basename of cwd
  "cwd": "/Users/karthik/claude/pixelagents",
  "gitBranch": "main",
  "title": "Pixelagents fullscreen home simulation", // from ai-title lines, else first user prompt (≤80 chars)
  "status": "working|thinking|idle|gone",
  "activity": "read|write|bash|web|agent|think|idle|error",
  "tool": "Edit",                 // current/last tool name or null
  "toolDetail": "public/js/world.js", // short human detail: file basename, command head (≤ 60 chars), query
  "lastPrompt": "...",            // ≤ 140 chars
  "lastText": "...",              // last assistant text ≤ 140 chars
  "startedAt": 1725000000000,     // first line timestamp
  "lastActivityAt": 1725000000000,// last line timestamp
  "turns": 12,                    // user prompts
  "toolCounts": { "Read": 10, "Edit": 4 },
  "model": "claude-fable-5-1",
  "permissionMode": "bypassPermissions",
  "helpers": 2                    // live subagents count
}
```

Server status rules (sessions.js):
* Session files: `~/.claude/projects/<proj>/<sessionId>.jsonl`; subagents `~/.claude/projects/<proj>/<sessionId>/subagents/agent-<id>.jsonl`.
* On start, consider only files modified within `idleTimeoutMin` (default 20, env `PA_IDLE_TIMEOUT_MIN`). Read only the last 512 KB for seeding, then tail incrementally (track byte offset; handle partial last line).
* Lines of interest: `type: "assistant"` with content blocks `tool_use` (pending tool, name+input) or `text`; `type: "user"` with `tool_result` blocks (clears pending; `is_error` → activity error) or string/text content (a prompt → turns++, lastPrompt); `type: "ai-title"` → title; ignore `attachment`, `file-history-snapshot`, `mode`, etc. Use `cwd`, `gitBranch`, `version`, `message.model` when present.
* status: pending tool_use → `working` (activity by tool category). No pending & last meaningful line is user prompt or tool_result → `thinking`. Last meaningful line is assistant text → `idle`, but only after 3 s of no new lines (debounce; before that `thinking`). `thinking` with no new lines for 10 min → `idle`. mtime older than idleTimeoutMin → `gone` (send once, then remove). Subagent file quiet for 5 min → gone.
* Broadcast: coalesce changes, at most every 250 ms. Send full snapshot to new clients.
* HTTP: `GET /` static from public/, `GET /api/state` (same as snapshot), `GET /api/floorplan` (house/floorplan.json), `GET /api/health`.
* Env: `PORT` (default 4321), `HOST` (0.0.0.0), `PA_PROJECTS_DIR` (default ~/.claude/projects), `PA_IDLE_TIMEOUT_MIN`, `PA_DEMO=<n>` fake agents.
* On listen, print: local URL, every non-internal IPv4 URL, and `http://<hostname>.local:PORT`.

## Rendering (renderer.js)

* World is drawn at native world pixels into an offscreen canvas per floor
  (static layer cached: floors, walls, doors, non-moving furniture; rebuilt on
  resize only if needed). Dynamic layer each frame: furniture that animates
  (washer drum, tv glow), agents (y-sorted with solid furniture by bottom edge),
  particles, floor-space bubbles.
* Screen canvas covers the whole viewport (devicePixelRatio aware). Layout:
  visible floors are arranged side-by-side or stacked, whichever yields the
  larger scale; scale = largest of {1, 1.5, 2, 2.5, 3, 4, 5, 6} that fits.
  `imageSmoothingEnabled = false`. Centered with a margin. Floor name label
  under/over each floor in screen space.
* Overlays drawn in screen space at full resolution (crisp text): name tags
  under each agent (name + project), speech bubbles (tool + detail) above,
  room labels (toggle `L`), selection ring, hover highlight.
* Day/night: real clock; 19:30–06:30 a bluish multiply overlay + warm window
  glows and lamps on. Lightweight.
* Camera: whole floors always fit; no panning (kiosk friendly). Optional
  `?zoom=1.5` multiplier later, not required.

## UI (ui.js)  — light theme, system-ui/Inter, restrained palette

* Top-left: title "Pixel Agents House", live dot + agent count, clock.
* Top-right buttons: Floors (auto / main / both), Labels, Fullscreen (Fullscreen API, key `F`), Hide UI (key `H`, kiosk `?kiosk=1` hides chrome until mouse moves).
* Roster (left, collapsible): one row per agent: color swatch, name, project, status pill, tool. Click → select (also click character on canvas). Selected → details card (name, project, cwd, branch, title, status, activity/chore + room, current tool detail, last prompt, last reply, turns, tool counts bars, started/elapsed, model, helpers).
* Toast when an agent arrives / leaves.
* All UI must work with mouse and touch (iPad on the wifi).

## Agents (agents.js)

Agent fields: id, info (AgentInfo), color palette (hash of id → skin/hair/shirt/pants),
floor, x, y (tile floats), px/py world pixels, facing, state
(`arriving|walking|chore|resting|thinking|leaving|gone`), chore, station,
path (array of cells + possible floor hop), anim tick, bubble text/timer,
particles. Speed ≈ 3.2 tiles/s (subagents 3.8, slightly smaller sprite, they
follow the parent's color family). Arrival: spawn at `spawn`, walk to front
door, enter. Leaving: walk to front door then to spawn, fade, remove.
Selecting an agent in the UI should not change its behaviour.

## Coding conventions

Vanilla ES modules (`export`/`import`), no bundler, no TypeScript, no frameworks.
Node ≥ 18, only deps: `ws`, `chokidar`. Keep functions small; comments only
where the intent is non-obvious. Never throw on bad data; log and continue.

## Module APIs (the contract between files — keep these exact)

### world.js
```js
export function buildWorld(planJson) // -> World
// World: { tile:16, width, height, plan, floorList:[Floor], floors:{[id]:Floor}, mainFloor:Floor, otherFloor(floor)->Floor|null }
// Floor: { id, name, outside, rooms:[Room], furniture:[Item], stations:[Station], doors, stairTransfer:[x,y], spawn?, frontDoor?,
//          roomAt(x,y)->Room|null, walkable(x,y)->bool  (in-bounds, not void/roof, not solid furniture),
//          hasWall(x,y,dir)->bool, doorAt(x,y,dir)->{kind,indoor}|null, edges:[{x,y,dir,kind,indoor}] (dir 'right'|'down' only, for drawing),
//          solidAt(x,y)->bool, labelPos(room)->{x,y} (tile center of the largest rect) }
// Room: { id, name, kind, floor(texture), stairs, rects, cells:number }
// Item: { type, x, y, w, h, facing, solid, room }
// Station: { id, chore, x, y, facing, area?, floorId, occupant:null|string, type? (furniture type) }
export function findPath(world, from, to) // from/to = {floorId,x,y}; -> [{floorId,x,y}] or null; 4-neighbour A*, respects walls/solids; cross-floor via stairTransfer
export function findStation(world, chores, preferFloorId, from) // chores: string[]; free station on preferFloor first, then other floor, else nearest occupied by BFS distance; -> Station|null
export function stationsFor(world, chore) // -> Station[]
export function nearestWalkable(floor, x, y, maxR=4) // -> [x,y]|null
export const CHORES_BY_ACTIVITY = { read:['desk','read','bookshelf','mail','pantry'], write:['cook','chop','grill','workbench','fold','makebed','dishes'], bash:['mow','trash','washcar','fix','laundry','vacuum','rake','dishes','scrub','workbench'], web:['tv','phone','pool','desk'], agent:['helper','water'], idle:['sit','coffee','water'], nap:['nap'], think:[] }
```

### sprites.js
```js
export const TILE = 16;
export function makePalette(seed)            // string -> {skin,hair,shirt,pants,shoes,accent,name?}; deterministic
export function drawCharacter(ctx, c)        // c = {x,y (world px, feet bottom-center), facing, frame:0-3, pose:'walk'|'stand'|'sit'|'sleep'|'think'|'work', chore, palette, small:boolean, tick}
export function drawFloorTile(ctx, texture, x, y)         // texture: wood|tile|carpet|concrete|pavers|lawn|asphalt|void|roof ; x,y tiles
export function drawWallEdge(ctx, edge)                   // edge {x,y,dir:'right'|'down',kind:'wall'|'door'|'double'|'slider'|'garage'|'opening',indoor:boolean}
export function furnitureSize(type)                       // -> {w,h}
export function furnitureSolid(type)                      // -> bool
export function drawFurniture(ctx, item, tick)            // base pass (y-sorted with agents by bottom edge)
export function drawFurnitureFront(ctx, item, tick)       // optional overlap strip drawn after agents on the same tiles
export function choreFx(chore)                            // -> null | {every:ms, spawn(x,y,rng)->particle}
export function drawParticle(ctx, p)                      // particle {x,y,vx,vy,life,maxLife,kind}
export function drawStairs(ctx, room, floor)              // decorative stair treads over a stairs room (called by renderer)
export const CHORE_LABEL = { cook:'cooking', mow:'mowing the lawn', ... } // human text for UI/bubbles for every chore in ARCHITECTURE
```

### agents.js
```js
export class AgentManager {
  constructor(world)
  applySnapshot(list) ; applyUpdate(list, removed)   // AgentInfo[]
  update(dt, now)                                    // seconds, ms
  get list()                                         // Agent[]
  hitTest(floorId, wx, wy)                           // -> Agent|null (world px)
  floorsInUse()                                      // Set<floorId>
}
// Agent: { id, info, palette, floorId, x, y (tile floats, feet), px, py, facing, state, chore, station, pose, frame, bubble:{text,until}|null, particles:[], enteredAt }
```

### renderer.js
```js
export function createRenderer(canvas, world) // -> { resize(), render(view), screenToWorld(sx,sy)->{floorId,x,y,wx,wy}|null, worldToScreen(floorId,wx,wy)->{x,y,scale}, layout:{floors:[{id,x,y,scale}]} }
// view = { agents:Agent[], visibleFloors:string[], selectedId, hoverId, showLabels:boolean, now:number, tick:number, night:boolean }
```

### ui.js
```js
export function createUI(handlers) // handlers: { onSelect(id|null), onFloorsMode('auto'|'main'|'both'), onLabels(bool), onFullscreen() }
// -> { setAgents(agents:Agent[]), setSelected(agent|null), setConnected(bool), toast(text), setFloorsMode(m), setLabels(b), setHidden(b) }
```

### net.js
```js
export function connect({ onHello, onSnapshot, onUpdate, onStatus }) // reconnects with backoff; onStatus(connected:boolean)
```

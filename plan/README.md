# MR 3D Floor Studio (web)

A static, offline-capable web companion to the MR 3D Floor iPhone app. Open `plan/index.html` from any
static server, for example `python3 -m http.server` at the repository root, then go to `/plan/`.
There is no build step and no network access: everything, including three.js (`vendor/`), is
served from this folder.

| Tab | What it does |
|---|---|
| **Summary** | Area, baseboard, door, window and opening trim, and paintable wall area; a per-room table; a numbered door and window schedule (width, height, sill, distance from each corner). Tap a row to jump to that element on the plan. |
| **Plan** | Zoom (pinch, wheel, double-tap, ±, fit) and pan. Every wall's length, plus a chain dimension giving each door and window position. Inside or centreline dimensions, metric or feet-inches. Editing tools and an object library (see below). |
| **Model** | 3D model built from the same plan, so edits show up immediately. Orbit, top and walk modes; cut-walls (dollhouse) view; room names. |
| **Photo** | Gallery and viewer: zoom and pan, swipe between photos, filmstrip, info panel with a mini-map of where the photo was taken, annotations. |

## Editing

| Tool | Key | Use |
|---|---|---|
| Select | V | Tap to select; drag to move. Handles resize, rotate, move wall ends, move whole walls, and resize openings. |
| Wall / Divider | W / L | Tap-tap to draw walls. They snap to 45° angles, wall ends and alignment with other walls. Walls are split automatically where they meet or cross, so rooms stay closed. |
| Door / Window / Opening | D / N / O | Tap a wall to place one. Drag it along the wall, or type its distance from corner A or B. |
| Objects | F | Searchable library (FR/EN): shower, bathtub, toilet, vanity, kitchen, laundry, furniture, stairs… Objects snap with their back to the nearest wall, and the selected object shows its clearance to the walls. |
| Room / Measure / Note / Photo | R / M / T / P | Name a closed area, measure between two points, add a note, or pin a photo on the plan. |

Lengths accept `3.52`, `3,52`, `352cm`, `11' 6"`, `138"` or `5 1/2"`.
Shortcuts: ⌘Z / ⇧⌘Z (undo/redo), ⌫ (delete), ⌘D (duplicate), R (rotate 90°), arrows (nudge),
+ / − / 0 (zoom / fit), Esc (cancel).

## Files

`js/model.js` (data model and measurements) · `js/geometry.js` · `js/units.js` · `js/catalog.js`
(object library and plan symbols) · `js/planview.js` (renderer) · `js/editor.js` (Plan tab) ·
`js/view3d.js` · `js/photos.js` · `js/summary.js` · `js/app.js`.

The plan file format (`*.mr3dfloor.json`) is documented at the top of `js/model.js`. The Swift
package in `../ios-reference/` reads and writes the same format.

## Tests

```
cd plan && npm test     # node --test: geometry, rooms, dimension chains, take-off, units
```

# MR 3D Floor: Plan view, editing and photo viewer review

*September 2026. Based on the current Plan tab (`example-floor-plan.png`, "Floor 2") and the
Support page's list of features.*

The MR 3D Floor iOS source code is not in this repository, so the review has two parts. First, it
describes what the current screen does. Second, it points to working implementations of every fix:

| Deliverable | Where | What it is |
|---|---|---|
| Web **Plan Studio** | `plan/` (open `plan/index.html`) | A complete working reference: zoomable plan, full dimensioning, editor, object library, 3D model, photo viewer, summary/take-off, JSON/SVG/PNG/CSV export. Runs offline. |
| **SwiftUI port** | `ios-reference/` (Swift package `MR3DPlanKit`) | Drop-in iOS 17 code: same data model, algorithms and views, RoomPlan import. The core (model, geometry, units, editor model) compiles and passes 48 tests, including a JSON round trip with the web studio. The SwiftUI, SceneKit and RoomPlan files were only syntax-checked, so expect small fixes on the first Xcode build. |
| Shared file format | `*.mr3dfloor.json` | The same JSON on the web and on iOS, so a plan can move between the two. |

---

## 1. What the current Plan tab does well

* The plan is clean and readable: thick black walls, blue windows, cyan objects, and a header with the size (6.30 × 10.69 m ≈ 67.3 m²).
* Trim take-off (baseboard, door, window and opening trim) is a strong feature for contractors.
* The Summary / Plan / Model / Photo segmented control is the right structure.

## 2. Problems found (by severity)

### Blocking: what the owner asked for

1. **The plan cannot be zoomed or panned.** It is fitted to the screen once. On a 6 × 11 m floor
   one wall pixel is about 1.4 cm, so short walls (the 45 cm stub, the 58 cm jog) cannot be read or tapped.
2. **Not every wall has a length.** Only some walls show a number (3.81, 3.52, 4.58, 4.97, 1.89,
   1.90, 6.11). The small return walls, the upper room's left wall and the interior walls have no dimension.
3. **Door and window positions are not dimensioned.** You can see a window or door, but not
   *where* it is: there's no distance from the corner to the opening edge and no opening width. This is the main
   information a contractor, window installer or kitchen designer needs.
4. **The plan is read-only.** You can't correct a wall that the LiDAR scan got wrong, add a missing
   door, or add a shower, bathtub, vanity or any other object that RoomPlan didn't detect.
5. **The photo viewer is basic.** You can't pinch-zoom around a point, pan with limits, or double-tap to zoom. There's
   no filmstrip, no way to see where a photo was taken on the plan, and no annotations stored with the photo.

### Readability

6. **Labels overlap geometry.** "3.52 m" sits on the upper room's left wall, "3.52 m" on the right
   is covered by the fridge, and "58 cm" / "45 cm" overlap the wall ends.
7. **The trim line is cut off.** "…eboard ≈ 31.40 m … Opening trim 20.4…" runs past both
   screen edges. It should wrap or scroll, not be clipped.
8. **Doors have no swing arcs.** Cyan lines for doors and blue double lines for windows are hard to tell apart, and you can't tell a door's hinge side or opening direction.
9. **Objects are untyped cyan and grey boxes.** A bed, a sofa and a counter look the same. There
   are no architectural symbols (bed with pillows, toilet, tub, range burners and so on).
10. **Rooms have no names or areas on the plan.** The header shows only the total area.
11. **There's no scale reference** (no scale bar or grid) and no choice of units (contractors in
    Québec often work in feet and inches).
12. **Wall dimensions don't say what they measure** (centreline or finished inside face). The
    trim quantities depend on it.

### Data and model

13. **Dashed openings between rooms** have no properties (width, height), so they can't be scheduled.
14. **There's no door or window schedule.** Openings aren't numbered, and their sizes can't be exported as a list.

## 3. Recommendations and how the reference handles them

| # | Recommendation | Reference implementation |
|---|---|---|
| 1 | Pinch or wheel zoom anchored at the finger or cursor; pan; double-tap to zoom; "fit" button; zoom from ¼× to 40× the fitted scale; scale bar and adaptive grid. **Text and line weights stay the same size on screen while the geometry scales.** | `plan/js/planview.js` (`Viewport`); `ZoomablePlanView.swift` |
| 2 | Every wall gets an **overall dimension** on its outside face, with extension lines and 45° ticks. Labels never render upside down and are hidden when they don't fit, then reappear as you zoom in. Overall width and depth are drawn on top and left. | `renderPlan` → `dimLine` |
| 3 | Every wall with openings gets a second **chain dimension**: corner → opening edge → opening width → … → corner, colour-coded (blue windows, cyan doors). The inspector shows "From corner A" and "From corner B" and lets you **type either one** to move the opening precisely. | `model.wallChain`; inspector `opA/opB` |
| 4 | **Inside or centreline** dimension mode. Inside mode subtracts half the thickness of each wall it meets, which gives the tape-measure length. Trim quantities use inside lengths. | `model.wallInsideLength` |
| 5 | **Editor** tools: draw walls (angle snap, end-point and alignment snap, automatic T-junction and crossing splits so rooms stay closed), dividers, doors (single, double, sliding, pocket with hinge and swing flip), windows, openings, rooms (auto-detected closed faces, named by tapping), measure, notes, photo pins. Drag wall ends and move whole walls. Type exact lengths such as `3.52`, `3,52`, `352cm` or `11' 6"`. Undo and redo. | `plan/js/editor.js`, `model.js`; `PlanEditorModel.swift` |
| 6 | **Object library** with 40+ items and architectural symbols: shower, 60" shower, neo-angle shower, bathtub, freestanding tub, toilet, vanity and double vanity, pedestal sink, bidet, kitchen items, laundry and mechanical, living, bedroom, dining and office, stairs, column. Searchable in French and English. New objects **snap against the nearest wall** with their back to it. Selecting an object shows **clearance dimensions to the surrounding walls**, for example "shower 32 cm from the wall". | `catalog.js`; `ObjectLibrary.swift`, `PlanSymbols.swift` |
| 7 | Everything edited in the plan also appears in the **3D model**: walls with real openings, glass, door leaves, and a recognisable 3D mesh for each object type. The model has orbit, top and walk modes and a "cut walls" dollhouse view. | `plan/js/view3d.js`; `Model3DBuilder.swift` |
| 8 | **Photo viewer**: zoom toward the cursor or pinch point, double-tap for 2.5×, pan clamped to the image edges, swipe to the next photo, filmstrip, rotate, full screen, info panel with a **mini-map showing where the photo was taken and its field-of-view cone**, "Show on plan", and **annotations** (arrow, pen, line, text) saved with the photo. | `plan/js/photos.js`; `PhotoViewer.swift` |
| 9 | Room names and areas are drawn on the plan and shrink to fit small rooms. The trim line **wraps** instead of being cut off. | `studio.css .metrics` |
| 10 | **Summary**: per-room area, perimeter, baseboard and paintable wall area; a **numbered door and window schedule** (P1, F3…) with wall, room, width, height, sill and both corner offsets; wall list; object counts; CSV export. | `plan/js/summary.js` |
| 11 | Metric and imperial units (feet and inches to ½"), French and English, light and dark mode, phone and desktop layouts (the inspector becomes a bottom sheet on phones and keeps the selection in view). | `units.js`, `i18n.js`, `tokens.css` |

## 4. Suggested order for the iOS app

1. **Zoom and pan plus full dimensions** (`ZoomablePlanView`). This needs no data model change and has the biggest visible impact.
2. **Import from RoomPlan into `PlanDocument`** (`RoomPlanImport.swift`), and save the JSON next to each scan.
3. **Editor and object library.** The shower, bathtub and vanity requests come from here.
4. **Model tab from `PlanDocument`** (`Model3DBuilder`), so edits appear in 3D.
5. **Photo viewer.**
6. Existing exports (PDF, DXF, SVG, CSV) are generated from the edited `PlanDocument` rather than the raw scan.

## 5. Accuracy note

All dimensions remain **estimates from a LiDAR survey** (as the Support page states). Editing lets
the user correct the model, but the app should keep showing the disclaimer on exports.

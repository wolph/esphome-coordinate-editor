<h1 align="center">ESPHome coordinate editor</h1>

<p align="center">Map radar targets and edit rectangular zones in your ESPHome web interface.</p>

<p align="center">
  <a href="https://wolph.github.io/esphome-coordinate-editor/">Try the live demo</a> |
  <a href="https://wolph.github.io/esphome-coordinate-editor/walkthrough.html">Watch the walkthrough</a> |
  <a href="#quick-start">Quick start</a>
</p>

<p align="center">
  <a href="https://wolph.github.io/esphome-coordinate-editor/walkthrough.html">
    <img src="https://wolph.github.io/esphome-coordinate-editor/media/preview.svg?v=full-editor" alt="ESPHome coordinate editor: drag zones, enter bounds, Apply, Discard and switch to Top view" width="960" />
  </a>
</p>

The preview and [live demo](https://wolph.github.io/esphome-coordinate-editor/) use simulated
data. Try dragging, resizing, precise bounds, Apply and Discard without connecting a device.
Reset and sensor switching discard local edits. All demo entity reads and writes stay in memory.

- Drag cube faces to move XYZ zones and edges to resize them in an orbitable 3D scene.
- Edit precise rectangles in Top view, with equal X/Y scale.
- Enter exact bounds, move by keyboard and fit the viewport to your zones.
- Compare actual bounds with local drafts before applying changes.
- Show X/Y targets for 2D sensors and positioned XYZ targets with floor drop-lines for 3D sensors.
- Load one self-contained JavaScript custom element, with no runtime dependencies.

| Sensor mapping | Coordinates | Areas in the example | Writes |
| --- | --- | --- | --- |
| [LD2450](examples/ld2450.yaml) | 2D, millimetres displayed as metres | Three zones | Direct bound writes |
| [LD6004](examples/ld6004.yaml) | 3D, metres | Four detection areas | Staging numbers and area Apply button |
| [LD6002B](examples/ld6002b.yaml) | 3D, metres | Four detection and four interference areas | Staging numbers and area Apply button |

`coordinate-editor.js` uses the device's web server REST API. There is no build step for
device installation. The demo reuses the actual editor and these example mappings, adding
three simulated target slots. Matching simulated values do not confirm physical radar filtering
or hardware behaviour.

XYZ configurations open in **3D view**. Drag empty scene space to orbit, use the wheel or
zoom buttons, and reset the camera with **Reset view**. Zones with XYZ bounds appear as
transparent cuboids. Target drop-lines show height above the floor. All three axes use the same
unit scale. Initial framing includes the X/Y room and configured zone heights, leaving empty
negative Z space out of the scene.

Click a cube to select its area. Drag a face to translate the zone along that face: the top
face moves X/Y and side faces include height. Drag an edge to resize both perpendicular
bounds. The permanent X, Y and Z arrows resize one bound at a time.
Movement snaps to configured steps and stays within permitted bounds.
**Top view** preserves the precise rectangle editor: drag inside a zone to move it or drag a
corner to resize it. Both views retain local drafts. Numeric bounds are always available.

Arrow keys move X/Y while the scene has focus. PageUp and PageDown move Z in 3D view. Shift
multiplies the step by ten. Escape cancels a drag. In 3D, **Fit view** fits zones, drafts and
targets without changing permitted bounds. Solid outlines show actual values. Dashed outlines show local
drafts. Edits send no entity writes until **Apply**.

A 2D sensor needs no Z configuration and opens directly in the X/Y map. A target without a
usable Z value stays in the numeric list and Top view, without an invented height in 3D.
XY-only zones in an XYZ configuration appear as labelled floor footprints.

## Quick start

> [!NOTE]
> The installation examples pin `v0.1.0`, which uses an X/Y map.
> For the current controls and sensor mappings shown above, replace `@v0.1.0` in both module URLs with
> `@664b1e6f498e5233a781f41524ce039f33c426b6` to use this tested preview.

Merge one of the example YAML files into your device configuration, set its UART pins,
and retain your board, network and authentication settings. The YAML files are fragments,
not complete firmware configurations. Their entity names match the accompanying mapping files.

These examples require an ESPHome build with the new `web_server.js_extra_urls` option.
If your build rejects that option, use the local `js_include` route below.
Keep the stock web interface enabled. The editor mounts immediately below `<esp-app>` as a
sibling, outside the stock app's shadow DOM.

### LD2450: 2D, direct writes

Use [examples/ld2450.yaml](examples/ld2450.yaml) with this web-server configuration:

```yaml
web_server:
  version: 3
  js_extra_urls:
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@v0.1.0/coordinate-editor.js
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@v0.1.0/examples/ld2450-config.js
```

[ld2450-config.js](examples/ld2450-config.js) maps `Target X`, `Target Y` and four number
entities per zone across all three zones. LD2450 reports millimetres. The mapping uses
`scale: 0.001` to display metres and convert edited bounds back to millimetres.
It omits `axes.z` and all Z references.
Configure the LD2450 zone mode separately. Each of the four bound writes takes effect independently.

### LD6004: 3D, staged writes

Use [examples/ld6004.yaml](examples/ld6004.yaml) with:

```yaml
web_server:
  version: 3
  js_extra_urls:
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@v0.1.0/coordinate-editor.js
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@v0.1.0/examples/ld6004-config.js
```

[ld6004-config.js](examples/ld6004-config.js) maps X/Y/Z targets and four detection areas in
metres, with `scale: 1`. The YAML adapter supplies six template staging numbers and an
area-specific Apply button. Each button selects `area_id`, copies the draft to `area_config`,
then presses `apply_area`. Selecting the area first matters because selection discards
unapplied component edits.

The LD6004 adapter needs firmware containing the hub, sensor, number, select and button
components. The original example references the development series
[hub #19840](https://github.com/esphome/esphome/pull/19840),
[numbers #19843](https://github.com/esphome/esphome/pull/19843),
[select #19844](https://github.com/esphome/esphome/pull/19844) and
[buttons #19846](https://github.com/esphome/esphome/pull/19846).
Check your firmware's component availability before using the fragment.

For LD6002B, use [ld6002b.yaml](examples/ld6002b.yaml) and
[ld6002b-config.js](examples/ld6002b-config.js). The adapter uses the `ld6002b` components
and maps eight areas: four detection and four interference areas. There are no dwell areas.

Browsers fetch module scripts with CORS, so whatever host serves the files must send an
`Access-Control-Allow-Origin` header that admits the device's origin. jsDelivr does. A plain
file server on your LAN usually does not.

The URLs above pin the `v0.1.0` tag. See [CHANGELOG.md](CHANGELOG.md) for releases
and update the pinned ref when upgrading.

## Delivering configuration

The device generates its page, so an inline module is not normally available to edit.
The practical route is a second module URL in `js_extra_urls`, as shown above.
Host your own copy of the matching configuration file when changing entity names or room limits.
It assigns `window.coordinateEditorConfig`, then dispatches an event so either script can finish first:

```javascript
window.coordinateEditorConfig = {
  unit: "m",
  axes: {
    x: { min: -5, max: 5, step: 0.1 },
    y: { min: 0, max: 8, step: 0.1 },
  },
  pollMs: 1000,
  expireMs: 5000,
  targets: [{
    label: "Slot 1",
    x: { domain: "sensor", id: "Target 1 X", scale: 1 },
    y: { domain: "sensor", id: "Target 1 Y", scale: 1 },
  }],
  zones: [],
};
window.dispatchEvent(new Event("coordinate-editor-config"));
```

The loader chooses the first available source, in this order:

1. A `<script type="application/json" id="coordinate-editor-config">` element, parsed as JSON.
2. `window.coordinateEditorConfig`.
3. A JSON URL in `data-config` on `<coordinate-editor>` or on the script loading `coordinate-editor.js`.

A malformed higher-priority source reports an error. It does not silently fall back.
JSON URL requests have a four-second timeout. Host external JSON with suitable CORS headers.
The URL supplies configuration only. Entity requests still use the page's origin.

On a page you control, either of these forms works:

```html
<script type="application/json" id="coordinate-editor-config">
{"unit":"m","axes":{"x":{"min":-5,"max":5,"step":0.1},"y":{"min":0,"max":8,"step":0.1}},"pollMs":1000,"expireMs":5000,"targets":[],"zones":[]}
</script>
<coordinate-editor></coordinate-editor>
<script src="coordinate-editor.js"></script>
```

```html
<coordinate-editor data-config="/room.json"></coordinate-editor>
<script src="coordinate-editor.js"></script>
```

Automatic mounting waits for `<esp-app>` and configuration. It leaves an existing
`<coordinate-editor>` alone. Configuration is read on initialisation, not watched for live changes.
Assigning `editor.config` before inserting a manually created element remains supported and
bypasses automatic source selection.

### Local `js_include`

For firmware without `js_extra_urls`, concatenate the editor and one configuration into a local file:

```sh
cat coordinate-editor.js examples/ld2450-config.js > coordinate-editor-local.js
```

Then load it alongside the normal ESPHome web interface:

```yaml
web_server:
  version: 3
  js_include: coordinate-editor-local.js
```

Use `examples/ld6004-config.js` or `examples/ld6002b-config.js` for the corresponding adapter.
Existing scripts that create an element, assign `editor.config` and append it still work.
`js_include` embeds the local file as `/0.js`, as described in the
[ESPHome web-server documentation](https://esphome.io/components/web_server/).

## Configuration reference

| Field | Meaning |
| --- | --- |
| `unit` | Label for displayed coordinates, such as `m` or `mm`. Scaling comes from each reference. |
| `title`, `originLabel` | Optional strings, defaulting to `Coordinate zones` and `Origin`. |
| `axes.x`, `axes.y` | Required `{ min, max, step }` in displayed units. Values must be finite, `min < max`, `step > 0`. Steps are relative to `min`. |
| `axes.z` | Optional axis with the same fields. Omit for 2D. |
| `targets` | Array of coordinate slots. Use `[]` to show zones only. |
| `zones` | Array of rectangles or XYZ cuboids. Use `[]` for a target-only view. |
| `pollMs` | Poll interval in milliseconds, at least 250. Examples use 1000. |
| `expireMs` | Target expiry after a successful read, greater than `pollMs`. Examples use 5000. |
| `pendingTimeoutMs` | Optional deadline for staged actual-value confirmation, default 15000 ms. Must be finite, positive and at most 2147483647. Starts after the Apply HTTP response succeeds. |

Each entity reference is `{ domain, id, scale }`. `scale` is finite and positive and converts
raw values into displayed units. Writes divide by it. Read domains are `sensor`, `number` and
`binary_sensor`. Button references use `button`. REST responses need a finite numeric `value`
or numeric string. Binary sensors may return booleans. Unit-bearing `state` strings are not parsed.

A target has `x` and `y` references and an optional `label`. Add `z` to display altitude or height.
Optional `presence` adds a numeric `threshold` to a reference. Values at or above it mean present.
Optional `age` adds `max` to a reference, with `scale` converting the source report age to seconds.
Missing required data, absence or excessive age hides the target. Unavailable Z leaves valid X/Y visible.
Zero is a valid coordinate. Slot labels do not identify persistent people.

A zone has an optional `label` and `bounds` mapping `x_min`, `x_max`, `y_min`, `y_max` to references.
For Z bounds, configure `axes.z` and both `z_min` and `z_max`. Drafts must have positive extent
on each configured axis, fit within axis limits and follow their steps. Use native controls to disable an area.

### Write modes and review

- Omit `write` for a read-only zone.
- `write: "direct"` requires number references in `bounds`. Apply writes all bounds sequentially.
  A failure can leave mixed device bounds. The local draft stays available.
- `write: "staged"` reads actual bound sensors, writes the matching keys in `staging` to number
  entities, verifies every staging value, then presses `applyButton`, a button reference.
  Set `stagingHasNoSideEffects: true` only for numbers that do not change hardware when written.

The shared template numbers in the 3D examples meet that staging requirement. The actual
`area_config` controls are populated by the area-specific button only after selecting its area.
Staging read-back failure suppresses the button.

After staged Apply, the draft stays pending until actual bounds agree. If the deadline expires,
the editor clears pending, keeps the draft and reports that the device did not confirm.
It blocks further writes until you review the actual bounds and choose
**Keep draft after reviewing actual values**, or **Discard draft**. Review is disabled while
actual bounds are unavailable or a poll is in progress. A failed Apply HTTP response also
requires review because the command may already have reached the device.

Competing actual updates preserve local edits and require review, including updates during a
pending operation. Matching values later do not remove that review requirement.
Discard replaces the draft with the latest actual values. It never undoes a command already sent.

## REST naming rule

`id` in an editor reference is the entity's exact configured name, including spaces, case and
UTF-8. It is not the YAML `id` or a slug. For example, `name: "Target 1 X"` maps to:

```javascript
{ domain: "sensor", id: "Target 1 X", scale: 1 }
```

The editor requests `/sensor/Target%201%20X` using `encodeURIComponent`. Every non-empty
string is accepted as a name. Use the actual name exposed by your firmware if a friendly-name
prefix changes it. ESPHome's [entity lookup](https://github.com/esphome/esphome/blob/dev/esphome/components/web_server/web_server.cpp)
compares the decoded URL segment with `entity->get_name()`.

## Limitations

- Use one writer. Another browser or Home Assistant can change shared staging values between
  verification and the button press. The adapter does not provide a multi-client transaction.
- HTTP success and matching entity values are not hardware acknowledgement. The editor states
  that hardware confirmation is unavailable. A timeout does not cancel a command already sent.
- Separate REST reads can span adjacent sensor reports. They do not form a coherent frame.
  Without per-slot presence or report-age references, presence and source freshness remain unknown.
- Requests use the device origin and existing web-server authentication. Do not put passwords
  in configuration JavaScript. Opening the fixture shows simulated data only.
- Only the main device's entity paths are mapped. Sub-device path segments are not supported.
- A modern browser with custom elements, shadow DOM, fetch and AbortSignal support is required.
  Background tabs may delay timers. External script URLs need network access.

## Development

Use Node 24 or newer:

```sh
npm ci
npm test
```

The suite uses Node's test runner and jsdom. Neither is needed on the device or in the browser.
Install Chromium and run the browser checks with:

```sh
npx playwright install chromium
npm run check:demo
```

The browser check starts its own temporary loopback server and uses the actual editor and
simulator. It checks 3D orbit and zoom, cube selection, face movement, edge resizing and
clamped XYZ arrows, local drafts, staged and direct Apply, Discard, Top view, pause and resume,
all sensor presets, reduced motion and desktop, tablet and mobile layouts. It also checks SVG
image animation and its static reduced-motion fallback. Entity requests stay in memory. Console errors fail the check.
The Pages workflow runs this check before building the site.

Install `ffmpeg` with your system package manager (`brew install ffmpeg` on macOS or
`sudo apt-get install ffmpeg` on Debian/Ubuntu), then reproduce the walkthrough with:

```sh
npm run record:demo
```

The recorder uses the same browser interactions with presentation holds. It creates a
cropped H264 walkthrough, a 35-second SVG preview, a poster and English captions in
`demo/media/`. The SVG records the editor's vector layers and HTML controls at ten frames per
second, including the pointer, live input values, Apply, Discard and Top view. The controls use
SVG `foreignObject` elements with the recorded desktop layout. It shares unchanged layers and
plays without JavaScript or embedded bitmap images. Reduced motion shows a static frame.
Click the preview for the full video.
The video and poster show only the editor, leaving the page margins, sensor selector and
other demo controls outside the crop. Caption times follow the recorded
interactions, including pending and confirmed staged values. All footage uses simulated data.
The recorder closes its own browser and server and removes temporary capture files.

To serve the interactive demo and the test fixture:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/demo/` for the live simulator. Motion advances every 250 ms.
Pause freezes simulation time while editing remains available. Reduced motion starts the
simulation paused. Reset and preset switching rebuild the editor and cancel simulated
confirmations. The staged transport updates actual values about 600 ms after Apply, then
the editor confirms them by polling.

Build the public Pages artefact with:

```sh
npm run build:demo
```

The build writes a clean `dist/` containing the demo, media, editor and required example
modules. GitHub Pages deploys that directory from `master` through the Pages workflow.
Device installation still uses the original editor and configuration files directly.

Open `http://127.0.0.1:8765/tests/fixtures/coordinate-editor.html` for the diagnostic fixture.
Use `?mode=direct`, `?mode=staged` or `?mode=readonly` to isolate a mode.
The fixture deliberately leaves staged writes unconfirmed until `fixtureConfirm()` is called
in the browser console, so its shorter 1.5-second deadline can be inspected.

## Licence

[MIT](LICENSE), copyright Rick van Hattem.

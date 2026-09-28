# ESPHome coordinate editor

Map target coordinates and edit rectangular zones on an ESPHome device's web page.
`coordinate-editor.js` is a self-contained custom element written in plain JavaScript.
It uses the device's web server REST API, with no runtime dependencies or build step.

Drag a rectangle to move it, drag a corner to resize it, or type bounds in the side panel.
Arrow keys move the selected zone while the map has focus. Shift multiplies the step by ten.
Escape cancels a drag. **Fit view** changes the viewport without changing the allowed bounds.
Solid rectangles show actual values. Dashed rectangles show local drafts.

X and Y have equal visual scale. A 2D sensor needs no Z configuration. For a 3D sensor,
Z appears as a target value and optional editable bounds alongside the X/Y map.
There is no 3D scene.

> Screenshot placeholder: add a capture of `tests/fixtures/coordinate-editor.html` here.
> Label fixture captures as simulated data, not hardware captures.

## Quick start

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
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@main/coordinate-editor.js
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@main/examples/ld2450-config.js
```

[ld2450-config.js](examples/ld2450-config.js) maps `Target X`, `Target Y` and four zone number
entities. LD2450 reports millimetres. The mapping uses `scale: 0.001` to display metres and
convert edited bounds back to millimetres. It omits `axes.z` and all Z references.
Configure the LD2450 zone mode separately. Each of the four bound writes takes effect independently.

### LD6004: 3D, staged writes

Use [examples/ld6004.yaml](examples/ld6004.yaml) with:

```yaml
web_server:
  version: 3
  js_extra_urls:
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@main/coordinate-editor.js
    - https://cdn.jsdelivr.net/gh/wolph/esphome-coordinate-editor@main/examples/ld6004-config.js
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
`Access-Control-Allow-Origin` header that admits the device's origin. jsDelivr does; a plain
file server on your LAN usually does not.

The URLs above target `main` as supplied in the installation examples. They only resolve
once the files are published on that ref. Change the ref to your published branch, tag or
commit when hosting your own copy. Pin a tested commit or tag for devices that need stable behaviour.

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
| `zones` | Array of rectangles. Use `[]` for a target-only view. |
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
There is no build step. To inspect the simulated fixture:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tests/fixtures/coordinate-editor.html`.
Use `?mode=direct`, `?mode=staged` or `?mode=readonly` to isolate a mode.
The fixture deliberately leaves staged writes unconfirmed until `fixtureConfirm()` is called
in the browser console, so its shorter 1.5-second deadline can be inspected.

## Licence

[MIT](LICENSE), copyright Rick van Hattem.

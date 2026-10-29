# Changelog

## 0.1.1 - 2026-10-29

- Load the examples with `web_server: js_include` and a small addons module that imports the editor
  and its mapping, so they work on released ESPHome. The `js_extra_urls` option they used is not
  part of ESPHome.
- Show how to inline a custom mapping in the addons module instead of hosting a copy.

## 0.1.0 - Unreleased

- Extract the dependency-free coordinate editor into a standalone repository.
- Display X/Y targets and rectangular zones, with optional Z values and bounds.
- Support direct number writes and verified staging followed by an Apply button.
- Accept configured entity names, including spaces and UTF-8, in REST mappings.
- Limit pending confirmation to a configurable deadline and require review after expiry.
- Load configuration from page JSON, a global object or a JSON URL and mount below the ESPHome app.
- Include LD2450, LD6004 and eight-area LD6002B examples, a browser fixture and Node tests.

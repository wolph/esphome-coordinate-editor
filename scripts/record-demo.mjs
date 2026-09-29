import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { editorFrame, root, serveDemo, showPointer, waitReady } from "./demo-browser.mjs";
import { checkLayouts, runSequence } from "./demo-sequence.mjs";
import { checkSvgPreview, finishSvgCapture, startSvgCapture } from "./svg-preview.mjs";

/** @type {ReturnType<typeof promisify<typeof execFile>>} */
const execute = promisify(execFile);
/** @type {{width: number, height: number}} */
const viewport = { width: 1440, height: 1600 };
/** @type {boolean} */
const recording = !process.argv.includes("--check");

/** Keep every preset inside one editor-only crop, without page controls or margins.
 * @param {import('playwright').Page} page @returns {Promise<import('playwright').BoundingBox>}
 */
async function recordingCrop(page) {
  /** @type {number} */
  let height = 0;
  for (const preset of ["ld2450", "ld6002b", "ld6004"]) {
    await page.selectOption("#preset", preset);
    await waitReady(page, preset);
    /** @type {import('playwright').BoundingBox} */
    const box = await editorFrame(page).locator("coordinate-editor").boundingBox();
    height = Math.max(height, box.height);
  }
  await editorFrame(page).addStyleTag({ content: `coordinate-editor { min-height: ${Math.ceil(height / 2) * 2}px; border-radius: 0; }` });
  /** @type {import('playwright').BoundingBox} */
  const box = await editorFrame(page).locator("coordinate-editor").boundingBox();
  /** @type {import('playwright').BoundingBox} */
  const crop = { x: Math.ceil(box.x), y: Math.ceil(box.y),
    width: Math.floor(box.width / 2) * 2, height: Math.floor((box.height - 1) / 2) * 2 };
  assert.ok(crop.x + crop.width <= viewport.width && crop.y + crop.height <= viewport.height,
    "The complete editor crop fits inside the recording viewport");
  return crop;
}

/** @param {import('playwright').Page} page @param {Set<string>} errors @param {string} origin @returns {void} */
function inspectPage(page, errors, origin) {
  page.on("pageerror", (error) => errors.add(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.add(message.text()); });
  page.on("request", (request) => {
    /** @type {URL} */
    const url = new URL(request.url());
    if (url.origin !== origin || /^\/(sensor|number|binary_sensor|button)\//.test(url.pathname)) errors.add(`Unexpected network request: ${url.pathname}`);
  });
}

/** @param {number} seconds @returns {string} */
function timestamp(seconds) {
  /** @type {number} */
  const milliseconds = Math.round(seconds * 1000);
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

/** @param {{time: number, text: string}[]} cues @returns {string} */
function captions(cues) {
  /** @type {number} */
  const offset = cues[0].time;
  return "WEBVTT\n\n" + cues.slice(0, -1).map((cue, index) => {
    /** @type {string[]} */
    const lines = [];
    for (const word of cue.text.split(" ")) {
      if (!lines.length || lines.at(-1).length + word.length + 1 > 78) lines.push(word);
      else lines[lines.length - 1] += ` ${word}`;
    }
    return `${index + 1}\n${timestamp(cue.time - offset)} --> ${timestamp(cues[index + 1].time - offset)}\n${lines.join("\n")}\n`;
  }).join("\n");
}

/** @param {string} video @param {string} media @param {{time: number, text: string}[]} cues @param {import('playwright').BoundingBox} crop @returns {Promise<void>} */
async function exportMedia(video, media, cues, crop) {
  /** @type {string} */
  const mp4 = path.join(media, "walkthrough.mp4");
  /** @type {number} */
  const duration = cues.at(-1).time - cues[0].time;
  assert.ok(duration >= 45 && duration <= 60, `Presentation duration ${duration.toFixed(2)}s is in range`);
  await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(cues[0].time), "-i", video,
    "-t", String(duration), "-vf", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`,
    "-an", "-c:v", "libx264", "-crf", "23", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  await writeFile(path.join(media, "walkthrough.vtt"), captions(cues));
  /** @type {{stdout: string}} */
  const probe = await execute("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,pix_fmt", "-of", "json", mp4]);
  /** @type {any} */
  const metadata = JSON.parse(probe.stdout);
  assert.equal(metadata.streams[0].codec_name, "h264");
  assert.equal(metadata.streams[0].pix_fmt, "yuv420p");
  assert.equal(metadata.streams[0].width, crop.width);
  assert.equal(metadata.streams[0].height, crop.height);
  assert.ok(Number(metadata.format.duration) >= 45 && Number(metadata.format.duration) <= 60);
  /** @type {number} */
  const previewBytes = (await stat(path.join(media, "preview.svg"))).size;
  assert.ok(previewBytes <= 1024 * 1024, `SVG preview remains below 1 MiB (${previewBytes} bytes)`);
  console.log(`Recorded ${Number(metadata.format.duration).toFixed(2)}s, ${crop.width}x${crop.height}, H264/yuv420p. Captions follow observed interaction times.`);
}

/** Check reduced-motion startup in a fresh document without altering the recording.
 * @param {import('playwright').Browser} browser @param {string} url @param {Set<string>} errors @returns {Promise<void>}
 */
async function checkReducedMotion(browser, url, errors) {
  /** @type {import('playwright').BrowserContext} */
  const context = await browser.newContext({ viewport, locale: "en-GB", reducedMotion: "reduce" });
  try {
    /** @type {import('playwright').Page} */
    const page = await context.newPage();
    inspectPage(page, errors, new URL(url).origin);
    await page.goto(url);
    await waitReady(page);
    assert.equal(await page.locator("#pause").getAttribute("aria-label"), "Resume", "Reduced motion starts paused");
    assert.equal(await page.evaluate(() => window.demoApp.frame.contentWindow.demoFrame.simulator.elapsed), 0);
  } finally { await context.close(); }
}

/** @returns {Promise<void>} */
async function main() {
  /** @type {string} */
  const temporary = await mkdtemp(path.join(tmpdir(), "coordinate-recording-"));
  /** @type {{url: string, close: () => Promise<void>} | undefined} */
  let server;
  /** @type {import('playwright').Browser | undefined} */
  let browser;
  try {
    if (recording) await execute("ffmpeg", ["-version"]);
    server = await serveDemo();
    browser = await chromium.launch();
    /** @type {Set<string>} */
    const errors = new Set();
    /** @type {string} */
    const media = path.join(temporary, "media");
    if (recording) await mkdir(media, { recursive: true });
    /** @type {import('playwright').BrowserContext} */
    const context = await browser.newContext({ viewport, locale: "en-GB", reducedMotion: "no-preference",
      ...(recording ? { recordVideo: { dir: temporary, size: viewport } } : {}) });
    if (recording) await showPointer(context);
    /** @type {number} */
    const started = performance.now();
    /** @type {import('playwright').Page} */
    const page = await context.newPage();
    inspectPage(page, errors, new URL(server.url).origin);
    await page.goto(server.url);
    await waitReady(page);
    /** @type {import('playwright').BoundingBox | undefined} */
    const crop = recording ? await recordingCrop(page) : undefined;
    if (recording) await page.screenshot({ path: path.join(media, "poster.png"), clip: crop });
    /** @type {{time: number, text: string}[]} */
    const cues = [];
    if (recording) await startSvgCapture(editorFrame(page));
    await runSequence({ page, recording, started, cues });
    if (recording) await writeFile(path.join(media, "preview.svg"), await finishSvgCapture(editorFrame(page)));
    /** @type {string | undefined} */
    const video = recording ? await page.video().path() : undefined;
    if (!recording) {
      await checkLayouts(page);
      await checkSvgPreview(page, server.url);
    }
    await context.close();
    await checkReducedMotion(browser, server.url, errors);
    if (!recording) {
      // Page media emulation does not reach SVG image documents in Chromium.
      /** @type {import('playwright').Browser} */
      const reducedBrowser = await chromium.launch({ args: ["--force-prefers-reduced-motion"] });
      try {
        /** @type {import('playwright').Page} */
        const reducedPage = await reducedBrowser.newPage();
        inspectPage(reducedPage, errors, new URL(server.url).origin);
        await checkSvgPreview(reducedPage, server.url, true);
      } finally { await reducedBrowser.close(); }
    }
    assert.deepEqual([...errors], [], "No console errors, entity network requests or external requests");
    if (recording) {
      await exportMedia(video, media, cues, crop);
      await cp(media, path.join(root, "demo", "media"), { recursive: true });
    }
    console.log(recording ? "Assets saved in demo/media/." : "Browser checks passed: XYZ motion/orbit/zoom, cube selection, face translation, two-axis edge resizing, clamped arrows, staged/direct Apply, Discard, Top view, pause/resume, all presets, responsive layout and reduced motion.");
  } finally {
    /** @type {PromiseSettledResult<any>[]} */
    const cleanup = await Promise.allSettled([browser?.close(), server?.close(), rm(temporary, { recursive: true, force: true })]);
    /** @type {PromiseRejectedResult[]} */
    const failures = cleanup.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Recording cleanup failed");
  }
}

await main();

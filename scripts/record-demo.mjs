import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { root, serveDemo, showPointer, waitReady } from "./demo-browser.mjs";
import { checkLayouts, runSequence } from "./demo-sequence.mjs";

/** @type {ReturnType<typeof promisify<typeof execFile>>} */
const execute = promisify(execFile);
/** @type {{width: number, height: number}} */
const viewport = { width: 1440, height: 1200 };
/** @type {boolean} */
const recording = !process.argv.includes("--check");

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

/** @param {string} video @param {string} media @param {{time: number, text: string}[]} cues @returns {Promise<void>} */
async function exportMedia(video, media, cues) {
  /** @type {string} */
  const mp4 = path.join(media, "walkthrough.mp4");
  /** @type {number} */
  const duration = cues.at(-1).time - cues[0].time;
  assert.ok(duration >= 45 && duration <= 60, `Presentation duration ${duration.toFixed(2)}s is in range`);
  await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(cues[0].time), "-i", video,
    "-t", String(duration), "-an", "-c:v", "libx264", "-crf", "23", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-t", "12", "-filter_complex",
    "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3", path.join(media, "preview.gif")]);
  await writeFile(path.join(media, "walkthrough.vtt"), captions(cues));
  /** @type {{stdout: string}} */
  const probe = await execute("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,pix_fmt", "-of", "json", mp4]);
  /** @type {any} */
  const metadata = JSON.parse(probe.stdout);
  assert.equal(metadata.streams[0].codec_name, "h264");
  assert.equal(metadata.streams[0].pix_fmt, "yuv420p");
  assert.equal(metadata.streams[0].width, viewport.width);
  assert.equal(metadata.streams[0].height, viewport.height);
  assert.ok(Number(metadata.format.duration) >= 45 && Number(metadata.format.duration) <= 60);
  assert.ok((await stat(path.join(media, "preview.gif"))).size <= 5 * 1024 * 1024, "Preview remains below 5 MiB");
  console.log(`Recorded ${Number(metadata.format.duration).toFixed(2)}s, ${viewport.width}x${viewport.height}, H264/yuv420p. Captions follow observed interaction times.`);
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
    if (recording) await page.screenshot({ path: path.join(media, "poster.png") });
    /** @type {{time: number, text: string}[]} */
    const cues = [];
    await runSequence({ page, recording, started, cues });
    /** @type {string | undefined} */
    const video = recording ? await page.video().path() : undefined;
    if (!recording) await checkLayouts(page);
    await context.close();
    await checkReducedMotion(browser, server.url, errors);
    assert.deepEqual([...errors], [], "No console errors, entity network requests or external requests");
    if (recording) {
      await exportMedia(video, media, cues);
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

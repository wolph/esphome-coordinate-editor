import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** @type {string} */
const root = fileURLToPath(new URL("../", import.meta.url));

/** Build only the public demo, its media and the actual editor/configuration modules.
 * @param {string} [destination] @returns {Promise<void>}
 */
export async function buildDemo(destination = path.join(root, "dist")) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "demo"), { recursive: true });
  await mkdir(path.join(destination, "examples"), { recursive: true });
  for (const entry of await readdir(path.join(root, "demo"), { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".css") || entry.name === "frame.html")) {
      await cp(path.join(root, "demo", entry.name), path.join(destination, "demo", entry.name));
    } else if (entry.isDirectory() && entry.name === "media") {
      await cp(path.join(root, "demo", "media"), path.join(destination, "media"), { recursive: true });
    }
  }
  for (const name of ["index.html", "walkthrough.html"]) {
    /** @type {string} */
    const html = await readFile(path.join(root, "demo", name), "utf8");
    await writeFile(path.join(destination, name), html
      .replace('href="showcase.css"', 'href="demo/showcase.css"')
      .replace('src="app.js"', 'src="demo/app.js"')
      .replace('src="frame.html"', 'src="demo/frame.html"'));
  }
  await cp(path.join(root, "coordinate-editor.js"), path.join(destination, "coordinate-editor.js"));
  for (const id of ["ld2450", "ld6004", "ld6002b"]) {
    await cp(path.join(root, "examples", `${id}-config.js`), path.join(destination, "examples", `${id}-config.js`));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDemo();
  console.log("Built public demo in dist/");
}

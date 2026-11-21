import { build } from "esbuild"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

console.log("Bundling decart-entry.ts with esbuild...")
await build({
  entryPoints: ["vendor/decart-entry.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  minify: true,
  outfile: "vendor/decart-sdk.mjs"
})

// Completely strip any remaining Decart log prefix from the bundle
if (existsSync("vendor/decart-sdk.mjs")) {
  let content = readFileSync("vendor/decart-sdk.mjs", "utf8")
  content = content.replaceAll("[DecartSDK]", "[PruwearEngine]")
  writeFileSync("vendor/decart-sdk.mjs", content, "utf8")
}

const workerSrc = "node_modules/@decartai/sdk/dist/realtime/browser/frame-metadata-worker.js"
if (existsSync(workerSrc)) {
  mkdirSync("vendor", { recursive: true })
  cpSync(workerSrc, "vendor/frame-metadata-worker.js")
}

console.log("Prebundle finished successfully!")

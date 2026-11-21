import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const root = process.cwd()
const buildSrc = path.join(root, "build", "firefox-mv3-prod")
const extensionDest = path.join(root, "pruwear-firefox-extension")
const zipDest = path.join(root, "Pruwear-Firefox-Virtual-Try-On.zip")
const xpiDest = path.join(root, "pruwear-firefox.xpi")

console.log("Preparing Firefox extension release bundle...")

if (!fs.existsSync(buildSrc)) {
  console.error("Build directory not found:", buildSrc)
  process.exit(1)
}

// 1. Refresh pruwear-firefox-extension directory
if (fs.existsSync(extensionDest)) {
  fs.rmSync(extensionDest, { recursive: true, force: true })
}
fs.mkdirSync(extensionDest, { recursive: true })
fs.cpSync(buildSrc, extensionDest, { recursive: true })

// 2. Remove old zip and xpi if present
if (fs.existsSync(zipDest)) fs.unlinkSync(zipDest)
if (fs.existsSync(xpiDest)) fs.unlinkSync(xpiDest)

// 3. Compress extension directly into zip and xpi
console.log("Compressing into Pruwear-Firefox-Virtual-Try-On.zip...")
try {
  execSync(`tar -a -c -f "${zipDest}" -C "${extensionDest}" .`, { stdio: "inherit" })
} catch {
  execSync(`powershell -Command "Compress-Archive -Path '${extensionDest}\\*' -DestinationPath '${zipDest}' -Force"`, { stdio: "inherit" })
}

// Copy as .xpi for direct Firefox installation
fs.copyFileSync(zipDest, xpiDest)

console.log(`\n Firefox Extension ready!`)
console.log(`   - Unpacked Folder : ${extensionDest}`)
console.log(`   - Zip Package     : ${zipDest}`)
console.log(`   - XPI Package     : ${xpiDest}\n`)

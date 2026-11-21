import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const root = process.cwd()
const releaseDir = path.join(root, "release")
const extensionDest = path.join(releaseDir, "pruwear-extension")
const zipDest = path.join(root, "Pruwear-Virtual-Try-On.zip")

console.log("Preparing customer release bundle...")

if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true, force: true })
}
fs.mkdirSync(extensionDest, { recursive: true })

// Copy production extension files
const buildSrc = path.join(root, "build", "chrome-mv3-prod")
fs.cpSync(buildSrc, extensionDest, { recursive: true })

// Copy helper files
fs.copyFileSync(path.join(root, "START_HERE.html"), path.join(releaseDir, "START_HERE.html"))
if (fs.existsSync(path.join(root, "index.html"))) {
  fs.copyFileSync(path.join(root, "index.html"), path.join(releaseDir, "index.html"))
}
if (fs.existsSync(path.join(root, "activate-pruwear.bat"))) {
  fs.copyFileSync(path.join(root, "activate-pruwear.bat"), path.join(releaseDir, "activate-pruwear.bat"))
}
if (fs.existsSync(path.join(root, "LICENSE.txt"))) {
  fs.copyFileSync(path.join(root, "LICENSE.txt"), path.join(releaseDir, "LICENSE.txt"))
}

// Remove old zip
if (fs.existsSync(zipDest)) {
  fs.unlinkSync(zipDest)
}

// Zip release folder
console.log("Compressing into Pruwear-Virtual-Try-On.zip...")
try {
  execSync(`tar -a -c -f "${zipDest}" -C "${releaseDir}" .`, { stdio: "inherit" })
} catch {
  if (process.platform === "win32") {
    execSync(`powershell -Command "Compress-Archive -Path '${releaseDir}\\*' -DestinationPath '${zipDest}' -Force"`, { stdio: "inherit" })
  } else {
    execSync(`cd "${releaseDir}" && zip -r "${zipDest}" .`, { stdio: "inherit" })
  }
}

// Clean up temporary release directory
if (fs.existsSync(releaseDir)) {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
  } catch {}
}

console.log(`\n Release ready! Saved to: ${zipDest}\n`)

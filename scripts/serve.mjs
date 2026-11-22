import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const PORT = 8080
const ROOT = process.cwd()

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream"
}

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split("?")[0])
  if (reqPath === "/" || reqPath === "") reqPath = "/START_HERE.html"
  const filePath = path.join(ROOT, reqPath)

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" })
    return res.end("404 Not Found")
  }

  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Access-Control-Allow-Origin": "*"
  })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Pruwear portal running at http://localhost:${PORT}/START_HERE.html`)
})

// Background service worker. It handles Decart client token minting,
// image downloading, and custom user API connections (health check, testing & try-on inference).
//
// The fitting room and options pages ask it to:
//   token              → mint a short-lived Decart client token (the room never sees the real key)
//   image              → download a dragged image or product-page link without site cookies
//   status             → report current engine provider ("decart" or "custom") and readiness
//   test-key           → verify a Decart key before saving
//   test-custom-api    → test connectivity/auth for a user's custom try-on endpoint
//   tryon-custom-api   → send person frame + garment image to custom API, return fitted image
//   open-options       → reliably launch the options/settings tab

import { FIXED_SESSION_SECONDS, loadSettings, type CustomApiConfig, validateCustomApiConfig } from "./lib/settings"

const DECART_API = "https://api.decart.ai"
const MODEL = "lucy-vton-latest"
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"])

type OpenWearRequest =
  | { type: "image"; url?: string }
  | { type: "token" }
  | { type: "status" }
  | { type: "test-key"; apiKey?: string }
  | { type: "test-custom-api"; config?: Partial<CustomApiConfig> }
  | { type: "tryon-custom-api"; personDataUrl: string; garmentDataUrl: string; prompt?: string; garmentName?: string }
  | { type: "open-options" }

/** The saved Decart key, or the one being tested. */
async function apiKey(override?: string) {
  const key = (override ?? (await loadSettings()).apiKey).trim()
  if (!key) throw new Error("NO_KEY")
  return key
}

/** Calls the Decart REST API with a timeout and readable errors ("KEY_REJECTED" for bad keys). */
async function decart(path: string, key: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${DECART_API}${path}`, { ...init, headers: { ...init.headers, "X-API-KEY": key }, signal: controller.signal })
    if (response.status === 401 || response.status === 403) throw new Error("KEY_REJECTED")
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      let detail = text
      try { detail = JSON.parse(text).detail || text } catch { /* Plain-text error body. */ }
      throw new Error(`AI Engine returned ${response.status}${detail ? `: ${String(detail).slice(0, 160)}` : ""}`)
    }
    return response
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("AI Engine took too long to respond")
    throw error
  } finally { clearTimeout(timeout) }
}

/** Mints a 60-second client token scoped to Lucy VTON, per Decart's client-token guidance. */
async function createToken(override?: string) {
  const [key, settings] = await Promise.all([apiKey(override), loadSettings()])
  const response = await decart("/v1/client/tokens", key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60, allowedModels: [MODEL], constraints: { realtime: { maxSessionDuration: FIXED_SESSION_SECONDS } } })
  }, 15000)
  const token = await response.json()
  return { apiKey: token.apiKey as string, fastMode: settings.fastMode, sessionSeconds: FIXED_SESSION_SECONDS }
}

// ---------- Custom API Engine Integration ----------

function getCustomAuthHeaders(config: Partial<CustomApiConfig>): Record<string, string> {
  const headers: Record<string, string> = {}
  const authType = config.authType || "bearer"
  const key = (config.apiKey || "").trim()

  if (key) {
    if (authType === "bearer") {
      headers["Authorization"] = `Bearer ${key}`
    } else if (authType === "header") {
      const headerName = (config.authHeaderName || "Authorization").trim()
      headers[headerName] = key
    }
  }
  return headers
}

/** Converts base64 data URL to bytes for multipart/form-data requests */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const parts = dataUrl.split(",")
  const mimeMatch = parts[0]?.match(/data:([^;]+)/)
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg"
  const base64 = parts[1] || ""
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return { bytes, mime }
}

/** Tests reachability and authentication of a custom API endpoint */
async function testCustomApi(configOverride?: Partial<CustomApiConfig>) {
  const settings = await loadSettings()
  const config = { ...settings.customApi, ...(configOverride || {}) }

  const validation = validateCustomApiConfig(config)
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid API configuration")
  }

  const targetUrl = (config.healthEndpoint && config.healthEndpoint.trim())
    ? config.healthEndpoint.trim()
    : config.endpoint.trim()

  const headers: Record<string, string> = {
    "Accept": "application/json, image/*, */*",
    ...getCustomAuthHeaders(config)
  }

  const controller = new AbortController()
  const timeoutMs = Math.min((config.timeoutSeconds || 30) * 1000, 15000)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = performance.now()

  try {
    // Attempt GET or OPTIONS first
    let response = await fetch(targetUrl, {
      method: "GET",
      headers,
      signal: controller.signal
    }).catch(async () => {
      // If GET fails (e.g. 405 Method Not Allowed), test with POST / OPTIONS
      return await fetch(targetUrl, {
        method: "OPTIONS",
        headers,
        signal: controller.signal
      })
    })

    const latencyMs = Math.round(performance.now() - start)

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication Failed (HTTP ${response.status}). Check your Secret Key or Auth Header in extension settings.`)
    }

    // Status 2xx or 400/405/422 indicates the backend server is online and responding!
    if (response.ok || [400, 405, 422].includes(response.status)) {
      return {
        ok: true,
        latencyMs,
        status: response.status,
        targetUrl,
        message: `Connected successfully! (HTTP ${response.status}, ${latencyMs}ms latency)`
      }
    }

    throw new Error(`API server returned HTTP ${response.status}: ${response.statusText}`)
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Connection timed out after ${timeoutMs / 1000}s. Check if your server URL (${targetUrl}) is running and accessible.`)
    }
    const msg = String(err?.message || err)
    if (msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED") || msg.includes("NetworkError")) {
      throw new Error(`Could not connect to ${targetUrl}. Is your backend server running? (If testing locally, ensure host is accessible).`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Sends person mirror snapshot and garment image to custom Virtual Try-On API */
async function tryonCustomApi(params: {
  personDataUrl: string
  garmentDataUrl: string
  prompt?: string
  garmentName?: string
}) {
  const settings = await loadSettings()
  const config = settings.customApi

  const validation = validateCustomApiConfig(config)
  if (!validation.valid) {
    throw new Error(`Custom API not configured: ${validation.error}. Open extension settings.`)
  }

  const endpoint = config.endpoint.trim()
  const authHeaders = getCustomAuthHeaders(config)
  const timeoutMs = (config.timeoutSeconds || 30) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const personField = config.personField?.trim() || "person_image"
  const garmentField = config.garmentField?.trim() || "garment_image"
  const promptField = config.promptField?.trim() || "prompt"
  const promptValue = params.prompt || params.garmentName || "clothing"

  try {
    let response: Response

    if (config.format === "rest-form") {
      // Multipart / FormData format
      const formData = new FormData()
      const person = dataUrlToBytes(params.personDataUrl)
      const garment = dataUrlToBytes(params.garmentDataUrl)

      formData.append(personField, new Blob([person.bytes as unknown as BlobPart], { type: person.mime }), "person.jpg")
      formData.append(garmentField, new Blob([garment.bytes as unknown as BlobPart], { type: garment.mime }), "garment.jpg")
      formData.append(promptField, promptValue)
      if (params.garmentName) formData.append("name", params.garmentName)

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json, image/*",
          ...authHeaders
        },
        body: formData,
        signal: controller.signal
      })
    } else {
      // Default: JSON with Base64 Images
      const payload: Record<string, any> = {
        [personField]: params.personDataUrl,
        [garmentField]: params.garmentDataUrl,
        [promptField]: promptValue,
        name: params.garmentName || ""
      }

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, image/*",
          ...authHeaders
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      let detail = errorText
      try { detail = JSON.parse(errorText).detail || JSON.parse(errorText).message || errorText } catch {}
      throw new Error(`Custom API returned ${response.status}: ${String(detail).slice(0, 200)}`)
    }

    // Inspect response format: either binary image or JSON containing image URL/data
    const contentType = (response.headers.get("content-type") || "").toLowerCase()

    if (contentType.startsWith("image/")) {
      // Direct binary image returned
      return await imageDataUrl(response)
    }

    // JSON response
    const json = await response.json()
    const outputUrl =
      json.image ||
      json.image_url ||
      json.output ||
      json.output_url ||
      json.result ||
      json.preview ||
      json.data?.image ||
      json.url

    if (!outputUrl || typeof outputUrl !== "string") {
      throw new Error("Custom API responded with JSON, but did not contain an image field ('image', 'image_url', 'output' or 'result').")
    }

    // If it's already a data URL:
    if (outputUrl.startsWith("data:image/")) {
      return outputUrl
    }

    // If raw base64 without prefix:
    if (/^[A-Za-z0-9+/=]{100,}$/.test(outputUrl.replace(/\s+/g, ""))) {
      return `data:image/jpeg;base64,${outputUrl.trim()}`
    }

    // If public HTTP(S) URL:
    if (outputUrl.startsWith("http://") || outputUrl.startsWith("https://")) {
      const imgRes = await fetch(outputUrl, { signal: controller.signal })
      if (!imgRes.ok) throw new Error(`Could not load result image from ${outputUrl} (HTTP ${imgRes.status})`)
      return await imageDataUrl(imgRes)
    }

    throw new Error("Unrecognized image data returned by Custom API.")
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Custom API generation timed out after ${timeoutMs / 1000}s.`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Image download ----------

/** Only public http(s) URLs: never localhost or private-network addresses. */
function imageUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid image URL")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Drag a web image or upload a file")
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "0.0.0.0") {
    throw new Error("Private-network image URLs are not supported")
  }
  return url.href
}

/** Returns a dragged image as a data URL. A product-page link resolves to its og:image / twitter:image. */
async function getImage(url: string) {
  url = imageUrl(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetchPublic(url, controller.signal)
    const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || ""
    if (mime === "text/html") {
      const page = new TextDecoder().decode(await readBytes(response, MAX_PAGE_BYTES, { truncate: true }))
      const preview = previewImageUrl(page, url)
      if (!preview) throw new Error("This link has no public product image. Drag the photo itself or upload a file")
      const image = await fetchPublic(imageUrl(preview), controller.signal)
      return imageDataUrl(image)
    }
    return imageDataUrl(response)
  } finally { clearTimeout(timeout) }
}

/** credentials: "omit" so the shop never sees the request as coming from the logged-in user. */
async function fetchPublic(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "omit", redirect: "follow", signal })
  if (!response.ok) throw new Error(`Image or page returned ${response.status}`)
  return response
}

/** Reads a response body up to `limit` bytes. Pages are truncated (preview tags live in <head>);
 *  images over the limit are rejected. */
async function readBytes(response: Response, limit: number, { truncate = false } = {}) {
  if (!truncate && Number(response.headers.get("content-length")) > limit) throw new Error("Image exceeds 8 MB")
  if (!response.body) throw new Error("Image or page could not be read")
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  while (total < limit) {
    const { done, value } = await reader.read()
    if (done) break
    if (!truncate && total + value.length > limit) { await reader.cancel(); throw new Error("Image exceeds 8 MB") }
    const part = value.subarray(0, limit - total)
    chunks.push(part); total += part.length
  }
  if (total >= limit) await reader.cancel()
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

/** Finds the page's share image in its <meta property="og:image"> style tags or product image tags. */
function previewImageUrl(html: string, pageUrl: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), match[2] || match[3] || match[4]]))
    const name = (attributes.property || attributes.name || "").toLowerCase()
    if (!["og:image", "og:image:secure_url", "twitter:image"].includes(name) || !attributes.content) continue
    const decoded = attributes.content.replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    try { return new URL(decoded, pageUrl).href } catch { /* Try the next tag. */ }
  }

  // Fallback for Amazon and Shopify stores with link[rel=image_src]
  const linkMatch = html.match(/<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)
  if (linkMatch?.[1]) {
    try { return new URL(linkMatch[1], pageUrl).href } catch {}
  }

  // Fallback for Amazon main product image
  const amazonMatch = html.match(/data-old-hires=["']([^"']+)["']/i) || html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i)
  if (amazonMatch?.[1]) {
    try { return new URL(amazonMatch[1], pageUrl).href } catch {}
  }

  return null
}

async function imageDataUrl(response: Response) {
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || ""
  if (!IMAGE_TYPES.has(mime)) throw new Error("Use a JPG, PNG or WebP image")
  const bytes = await readBytes(response, MAX_IMAGE_BYTES)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

// ---------- Message handling ----------

chrome.runtime.onMessage.addListener((message: OpenWearRequest, sender, sendResponse) => {
  // Allow opening options from anywhere (iframe, content script, or popup)
  if (message?.type === "open-options") {
    const optionsUrl = chrome.runtime.getURL("options.html")
    try {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) {
          chrome.tabs.create({ url: optionsUrl }).catch(() => {})
        }
      })
    } catch {
      chrome.tabs.create({ url: optionsUrl }).catch(() => {})
    }
    sendResponse({ ok: true })
    return true
  }

  // Only OpenWear's own pages (fitting room, settings) may access API features
  const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""))
  if (!fromExtensionPage) return false

  const run = async () => {
    switch (message?.type) {
      case "image": return getImage(message.url || "")
      case "token": return createToken()
      case "status": {
        const settings = await loadSettings()
        const isCustom = settings.apiProvider === "custom"
        const hasKey = isCustom
          ? Boolean(settings.customApi.endpoint && settings.customApi.endpoint.trim())
          : Boolean(settings.apiKey && settings.apiKey.trim())
        return {
          hasKey,
          apiProvider: settings.apiProvider,
          customApiName: settings.customApi.name || "Custom API",
          customApiEndpoint: settings.customApi.endpoint
        }
      }
      case "test-key": {
        await createToken(message.apiKey)
        return { ok: true }
      }
      case "test-custom-api": {
        return await testCustomApi(message.config)
      }
      case "tryon-custom-api": {
        return await tryonCustomApi({
          personDataUrl: message.personDataUrl,
          garmentDataUrl: message.garmentDataUrl,
          prompt: message.prompt,
          garmentName: message.garmentName
        })
      }
      default: throw new Error("Unknown OpenWear request")
    }
  }

  run().then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: String(error?.message || error) })
  )
  return true
})

// Auto-open API key generation and options page whenever neither Decart nor Custom API is configured.
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await loadSettings()
  const isCustom = settings.apiProvider === "custom"
  const configured = isCustom ? !!settings.customApi.endpoint : !!settings.apiKey
  if (!configured) {
    const optionsUrl = chrome.runtime.getURL("options.html")
    chrome.tabs.create({ url: optionsUrl }).catch(() => {})
  }
  // Content scripts only run on pages loaded after install; add the launcher to tabs that are already open.
  const script = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0]
  if (!script) return
  for (const tab of await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] })) {
    if (tab.id) chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [script] }).catch(() => {})
  }
})

// Dev-only: an unpacked install can be reloaded from a localhost page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== "dev-reload" || !/^http:\/\/localhost(:\d+)?\//.test(sender.url || "")) return false
  chrome.management.getSelf().then(self => {
    if (self.installType !== "development") return sendResponse({ ok: false })
    sendResponse({ ok: true })
    setTimeout(() => chrome.runtime.reload(), 100)
  })
  return true
})

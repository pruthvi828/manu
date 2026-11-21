// Settings live in chrome.storage.local on this browser.
// Supports both Decart Lucy VTON 3.5 (WebRTC) and Custom Virtual Try-On APIs.

export const FIXED_SESSION_SECONDS = 15 // System-enforced policy: 15 seconds max fitting duration for cloud WebRTC (immutable)

export type ApiProvider = "decart" | "custom"
export type CustomApiFormat = "rest-json" | "rest-form" | "webrtc"
export type CustomAuthType = "bearer" | "header" | "none"

export type CustomApiConfig = {
  name: string
  endpoint: string
  healthEndpoint: string
  authType: CustomAuthType
  authHeaderName: string
  apiKey: string
  format: CustomApiFormat
  personField: string
  garmentField: string
  promptField: string
  timeoutSeconds: number
}

export type Settings = {
  apiProvider: ApiProvider
  apiKey: string
  fastMode: boolean
  sessionMinutes: number
  customApi: CustomApiConfig
}

export const BUILTIN_API_KEY = (
  process.env.PLASMO_PUBLIC_DECART_API_KEY ||
  process.env.DECART_API_KEY ||
  "dct_try-3_rSAGBJEwEakbsurBDzorqiBBeoXexdPWRMKmOnYoTEAeeVLDlykvcvgTdWcZlTsk"
).trim()

export const DEFAULT_CUSTOM_API: CustomApiConfig = {
  name: "My Custom Try-On API",
  endpoint: "",
  healthEndpoint: "",
  authType: "bearer",
  authHeaderName: "Authorization",
  apiKey: "",
  format: "rest-json",
  personField: "person_image",
  garmentField: "garment_image",
  promptField: "prompt",
  timeoutSeconds: 30
}

export const DEFAULT_SETTINGS: Settings = {
  apiProvider: "decart",
  apiKey: BUILTIN_API_KEY,
  fastMode: false,
  sessionMinutes: FIXED_SESSION_SECONDS / 60, // exactly 15 seconds for Decart
  customApi: DEFAULT_CUSTOM_API
}

export async function loadSettings(): Promise<Settings> {
  const saved = await chrome.storage.local.get([
    "apiProvider",
    "apiKey",
    "fastMode",
    "sessionMinutes",
    "customApi"
  ])

  const key = (saved.apiKey && String(saved.apiKey).trim()) || BUILTIN_API_KEY
  const provider: ApiProvider = saved.apiProvider === "custom" ? "custom" : "decart"
  const custom: CustomApiConfig = {
    ...DEFAULT_CUSTOM_API,
    ...(saved.customApi || {})
  }

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    apiProvider: provider,
    apiKey: key,
    customApi: custom,
    sessionMinutes: FIXED_SESSION_SECONDS / 60
  }
}

export async function saveSettings(patch: Partial<Settings>) {
  // Prevent any caller from overriding the 15-second session policy
  const { sessionMinutes, ...allowed } = patch as any
  await chrome.storage.local.set(allowed)
}

/**
 * Ultra-simple 1-step API setup:
 * Takes whatever the user entered (URL, key, or both), automatically detects
 * the type, saves it, and enables the extension immediately.
 */
export async function saveSimpleApi(endpointOrKey: string, optionalKey?: string): Promise<{ provider: ApiProvider; success: boolean }> {
  let primary = (endpointOrKey || "").trim()
  let secondary = (optionalKey || "").trim()

  if (!primary && !secondary) {
    throw new Error("Please enter an API URL or Key")
  }

  // If user only entered value into the secondary field, treat as primary
  if (!primary && secondary) {
    primary = secondary
    secondary = ""
  }

  // Check if primary looks like an endpoint URL or local server
  const isUrlLike =
    primary.startsWith("http://") ||
    primary.startsWith("https://") ||
    primary.includes("localhost") ||
    primary.includes("127.0.0.1") ||
    primary.includes(":") ||
    primary.includes("/") ||
    primary.includes(".com") ||
    primary.includes(".io") ||
    primary.includes(".ai") ||
    primary.includes(".net") ||
    primary.includes(".app") ||
    primary.includes(".runpod") ||
    primary.includes(".gradio") ||
    primary.includes(".ngrok")

  if (isUrlLike) {
    const fullUrl = (primary.startsWith("http://") || primary.startsWith("https://")) ? primary : `http://${primary}`
    const current = (await loadSettings()).customApi || DEFAULT_CUSTOM_API
    await saveSettings({
      apiProvider: "custom",
      customApi: {
        ...current,
        endpoint: fullUrl,
        apiKey: secondary,
        authType: secondary ? "bearer" : "none"
      }
    })
    return { provider: "custom", success: true }
  }

  // If looks like Decart key or token:
  if (primary.startsWith("dct_") || (!secondary && !primary.includes("."))) {
    await saveSettings({
      apiProvider: "decart",
      apiKey: primary
    })
    return { provider: "decart", success: true }
  }

  // Fallback: treat as custom endpoint
  const fullUrl = (primary.startsWith("http://") || primary.startsWith("https://")) ? primary : `http://${primary}`
  const current = (await loadSettings()).customApi || DEFAULT_CUSTOM_API
  await saveSettings({
    apiProvider: "custom",
    customApi: {
      ...current,
      endpoint: fullUrl,
      apiKey: secondary,
      authType: secondary ? "bearer" : "none"
    }
  })
  return { provider: "custom", success: true }
}

/** Validates custom API endpoint and parameters */
export function validateCustomApiConfig(config: Partial<CustomApiConfig>): { valid: boolean; error?: string } {
  if (!config) return { valid: false, error: "Empty configuration provided" }
  const endpoint = (config.endpoint || "").trim()
  if (!endpoint) return { valid: false, error: "API Endpoint URL is required" }

  try {
    const url = new URL(endpoint)
    if (!["http:", "https:"].includes(url.protocol)) {
      return { valid: false, error: "Endpoint URL must start with http:// or https://" }
    }
  } catch {
    return { valid: false, error: "Invalid endpoint URL format" }
  }

  if (config.healthEndpoint && config.healthEndpoint.trim()) {
    try {
      const hUrl = new URL(config.healthEndpoint.trim())
      if (!["http:", "https:"].includes(hUrl.protocol)) {
        return { valid: false, error: "Health check URL must start with http:// or https://" }
      }
    } catch {
      return { valid: false, error: "Invalid health check URL format" }
    }
  }

  return { valid: true }
}

/** Parses uploaded or pasted JSON configuration for the Custom API */
export function parseUploadedApiConfig(jsonString: string): {
  success: boolean
  config?: Partial<CustomApiConfig>
  provider?: ApiProvider
  error?: string
} {
  try {
    const parsed = JSON.parse(jsonString)
    if (typeof parsed !== "object" || !parsed) {
      return { success: false, error: "Invalid JSON configuration object" }
    }

    // Support both direct customApi config or wrapped settings config
    const raw = parsed.customApi || parsed

    const endpoint = String(raw.endpoint || raw.apiUrl || raw.url || raw.api_url || "").trim()
    if (!endpoint) {
      return { success: false, error: "Configuration must include 'endpoint' (or 'apiUrl')" }
    }

    const config: Partial<CustomApiConfig> = {
      name: String(raw.name || raw.apiName || "Imported Custom API").trim(),
      endpoint,
      healthEndpoint: String(raw.healthEndpoint || raw.health_endpoint || raw.health || "").trim(),
      authType: ["bearer", "header", "none"].includes(raw.authType || raw.auth_type)
        ? (raw.authType || raw.auth_type)
        : raw.apiKey ? "bearer" : "none",
      authHeaderName: String(raw.authHeaderName || raw.auth_header_name || "Authorization").trim(),
      apiKey: String(raw.apiKey || raw.api_key || raw.token || "").trim(),
      format: ["rest-json", "rest-form", "webrtc"].includes(raw.format)
        ? raw.format
        : "rest-json",
      personField: String(raw.personField || raw.person_field || "person_image").trim(),
      garmentField: String(raw.garmentField || raw.garment_field || "garment_image").trim(),
      promptField: String(raw.promptField || raw.prompt_field || "prompt").trim(),
      timeoutSeconds: Number(raw.timeoutSeconds || raw.timeout_seconds || 30) || 30
    }

    const validation = validateCustomApiConfig(config)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    return {
      success: true,
      config,
      provider: "custom"
    }
  } catch (err: any) {
    return { success: false, error: `JSON Parse error: ${err?.message || "Invalid JSON"}` }
  }
}

/** Returns a downloadable sample template JSON for custom API */
export function getSampleApiConfigTemplate(): string {
  const sample = {
    $schema: "https://pruwear.ai/schemas/vton-api-v1.json",
    name: "My Custom Virtual Try-On API",
    endpoint: "http://localhost:8000/api/tryon",
    healthEndpoint: "http://localhost:8000/health",
    format: "rest-json",
    authType: "bearer",
    authHeaderName: "Authorization",
    apiKey: "your-secret-api-token-here",
    personField: "person_image",
    garmentField: "garment_image",
    promptField: "prompt",
    timeoutSeconds: 30,
    documentation: {
      description: "Upload this JSON file directly into the Pruwear extension settings whenever your backend is ready.",
      payloadTypes: {
        "rest-json": "Sends JSON with base64 data URLs for person and garment images",
        "rest-form": "Sends multipart/form-data with binary image files"
      },
      responseFormats: [
        "Direct binary image (content-type: image/jpeg or image/png)",
        "JSON with image field: { \"image_url\": \"https://...\" } or { \"image\": \"data:image/jpeg;base64,...\" }"
      ]
    }
  }
  return JSON.stringify(sample, null, 2)
}

/** Returns sample Python FastAPI boilerplate for developers */
export function getSamplePythonFastAPICode(): string {
  return `"""
Pruwear Custom Virtual Try-On API Server (FastAPI Template)
Run with: uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import base64

app = FastAPI(title="Pruwear Custom Try-On Server")

# Allow extension origin calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TryOnRequest(BaseModel):
    person_image: str   # base64 data URL from live mirror camera
    garment_image: str  # base64 data URL from dragged shop item
    prompt: Optional[str] = "clothing"

@app.get("/health")
def health_check():
    return {"status": "ok", "engine": "custom-vton-v1"}

@app.post("/api/tryon")
async def try_on(payload: TryOnRequest, authorization: Optional[str] = Header(None)):
    # 1. Optional Auth Check
    # if authorization != "Bearer your-secret-api-token-here":
    #     raise HTTPException(status_code=401, detail="Unauthorized")

    # 2. Extract person and garment images
    # person_data = payload.person_image
    # garment_data = payload.garment_image
    
    # 3. Feed into your ML model (IDM-VTON, CatVTON, FastVITON, etc.)
    # result_image_bytes = run_vton_model(person_data, garment_data)
    
    # 4. Return result image URL or base64 data URL:
    return {
        "status": "success",
        # Return either a public URL or base64 data URI:
        "image": payload.person_image  # Replace with generated output image
    }
`
}

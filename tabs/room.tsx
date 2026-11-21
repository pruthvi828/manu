// The fitting room: camera, body-framing guide, Decart live try-on and the laser-scan effect.
//
// It runs as an extension page (tabs/room.html) inside an iframe that content.tsx places on the shop.
// Keeping it on the extension's own origin isolates the camera, the Decart session and the MediaPipe
// runtime from the shop's scripts and security policy.
//
// Flow: Enable camera → framing guide (head + shoulders in the outline) → garment dropped →
//       connect to Decart with that garment → laser scan while it applies → reveal the AI video.
//       Later garments reuse the same connection via set().

import { createDecartClient, models, noopLogger } from "../vendor/decart-sdk.mjs"
import { useCallback, useEffect, useRef, useState } from "react"
import { nameFromFile, parseDrop, type Incoming } from "../lib/drop"
import { buildPrompt, cleanName, normalizeImage, LOOKBOOK_ITEMS, type LookbookItem } from "../lib/garment"
import { createPoseTracker, coverRect, guide, silhouetteBox, SILHOUETTE, type Point } from "../lib/vision"
import { saveSimpleApi } from "../lib/settings"
import logoUrl from "../assets/a20a55db344221837dd80a3b7597b5f3.jpg"
import "./room.css"

type Reply<T> = { ok: true; data: T } | { ok: false; error: string }
type Phase = "idle" | "starting" | "framing" | "ready"
type GarmentStatus = "reading" | "waiting" | "fitting" | "live" | "failed"
type Garment = { id: number; name: string; preview: string; status: GarmentStatus }
type Token = { apiKey: string; fastMode: boolean; sessionSeconds: number }
type Notice = { message: string; action?: "settings" | "grant" | "restart" }

const model = models.realtime("lucy-vton-latest")
const SCAN_REVEAL_MS = 1300 // final top-to-bottom sweep that reveals the AI video
const SETTLE_MS = 900 // Decart needs a moment after set() before frames show the new garment
const HOLD_MS = 900 // how long the user must stay in the outline before framing completes
// The same page doubles as a full-tab "allow camera" screen when opened with ?grant (see GrantPage).
const isGrantPage = new URLSearchParams(location.search).has("grant")

/** Sends a request to background.ts, which holds the API key and fetches images. */
async function background<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  const response: Reply<T> = await chrome.runtime.sendMessage({ type, ...fields })
  if (!response?.ok) throw new Error((response as { error?: string })?.error || "OpenWear is unavailable")
  return response.data
}

/** Opens options page via background worker with tab fallback, working reliably inside iframes. */
function openOptions() {
  chrome.runtime.sendMessage({ type: "open-options" }).catch(() => {
    window.open(chrome.runtime.getURL("options.html"), "_blank")
  })
}

/** Maps camera, key and network failures to a message plus the one action that fixes it. */
function friendly(error: any): Notice {
  const message = String(error?.message || error || "")
  if (message === "NO_KEY") return { message: "Add your AI Engine key or configure Custom API in settings.", action: "settings" }
  if (message === "KEY_REJECTED" || error?.code === "INVALID_API_KEY") return { message: "The AI Engine rejected your API key. Check it in settings.", action: "settings" }
  if (message.includes("Custom API not configured")) return { message: "Custom API not configured. Open settings to upload or add your endpoint.", action: "settings" }
  if (message.includes("Authentication Failed") || message.includes("401") || message.includes("403")) return { message: "API authentication failed. Check your Secret Key or Auth Header in settings.", action: "settings" }
  if (error?.name === "NotAllowedError") return { message: "Camera access is blocked for Pruwear.", action: "grant" }
  if (error?.name === "NotFoundError") return { message: "No camera found. Plug one in and try again." }
  if (error?.code === "WEBRTC_SERVER_ERROR" && message) {
    if (/credit|quota|balance|payment|unpaid/i.test(message)) {
      return { message: "AI Engine credits depleted. Add credits at platform dashboard.", action: "settings" }
    }
    return { message: `AI Server: ${message}`, action: "restart" }
  }
  if (error?.code?.startsWith?.("WEBRTC")) return { message: "Couldn't reach AI video servers. Check your network and try again.", action: "restart" }
  return { message: message || "Something went wrong. Try again.", action: "restart" }
}

/** Fallback when the browser won't prompt for the camera inside the iframe: ask from a full tab instead. */
function GrantPage() {
  const [state, setState] = useState<"ask" | "done" | "blocked">("ask")
  const ask = async () => {
    try { (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach(track => track.stop()); setState("done") }
    catch { setState("blocked") }
  }
  return <main className="grant">
    <img src={logoUrl} alt="Pruwear" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4, marginBottom: 16 }} />
    <span className="kicker">Pruwear · Camera</span>
    <h1>{state === "done" ? "Camera allowed" : "Camera access"}</h1>
    <p>{state === "done" ? "Close this tab, return to the shopping tab and press Start Fitting." : state === "blocked" ? "Your browser blocked the camera. Click the camera icon in the address bar, allow access, then try again." : "Your video stream is processed in real time and never stored."}</p>
    {state !== "done" && <button className="primary" onClick={() => void ask()}>Allow Camera</button>}
    {state === "done" && <button className="primary" onClick={() => window.close()}>Close Tab</button>}
  </main>
}

function Room() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [apiProvider, setApiProvider] = useState<string>("decart")
  const [customApiName, setCustomApiName] = useState<string>("Custom API")
  const [customResultImage, setCustomResultImage] = useState<string>("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [garment, setGarment] = useState<Garment | null>(null)
  const [guidance, setGuidance] = useState({ ok: false, message: "Step into the frame" })
  const [holding, setHolding] = useState(false)
  const [visionReady, setVisionReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [remoteVisible, setRemoteVisible] = useState(false)
  const [connection, setConnection] = useState("")
  const [queue, setQueue] = useState<{ position: number; queueSize: number } | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [flashing, setFlashing] = useState(false)
  const [showLookbook, setShowLookbook] = useState(false)
  const [studioMood, setStudioMood] = useState<"natural" | "warm" | "high-contrast" | "editorial">("natural")
  const [editingName, setEditingName] = useState(false)

  // Direct simple API input state
  const [inlineApiUrl, setInlineApiUrl] = useState("")
  const [inlineApiKey, setInlineApiKey] = useState("")
  const [inlineBusy, setInlineBusy] = useState(false)
  const [inlineError, setInlineError] = useState("")
  const [isEditingApi, setIsEditingApi] = useState(false)
  const [activeEndpoint, setActiveEndpoint] = useState("")

  // Refs mirror state that the animation loop and async callbacks read without re-rendering.
  const stageRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)
  const remoteImgRef = useRef<HTMLImageElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const connectionRef = useRef<any>(null)
  const connectingRef = useRef<Promise<any> | null>(null)
  const connectingForRef = useRef(0)
  const remoteShownRef = useRef(false)
  const apiProviderRef = useRef<string>("decart")
  const trackerRef = useRef<Awaited<ReturnType<typeof createPoseTracker>> | null>(null)
  const poseRef = useRef<Point[] | null>(null)
  const phaseRef = useRef<Phase>("idle")
  const framedRef = useRef(false)
  const framedWaitersRef = useRef<(() => void)[]>([])
  const holdStartRef = useRef(0)
  const scanRef = useRef<{ mode: "off" | "loop" | "reveal"; start: number; revealRemote: boolean }>({ mode: "off", start: 0, revealRemote: false })
  const garmentRef = useRef<Garment | null>(null)
  const imageRef = useRef<Blob | null>(null)
  const sessionRef = useRef(0) // bumped on stop(); async work from an older session bails out
  const garmentSeqRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  phaseRef.current = phase
  garmentRef.current = garment
  apiProviderRef.current = apiProvider

  const updateGarment = useCallback((id: number, patch: Partial<Garment>) => {
    setGarment(current => current && current.id === id ? { ...current, ...patch } : current)
  }, [])

  // ---------- Session lifecycle ----------

  /** Ends everything: Decart connection, camera, timers and effects. Always safe to call. */
  const stop = useCallback((reason?: Notice) => {
    sessionRef.current++
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    connectionRef.current?.disconnect()
    connectionRef.current = null
    connectingRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (cameraRef.current) cameraRef.current.srcObject = null
    if (remoteRef.current) remoteRef.current.srcObject = null
    framedRef.current = false
    framedWaitersRef.current = []
    remoteShownRef.current = false
    scanRef.current = { mode: "off", start: 0, revealRemote: false }
    setCustomResultImage("")
    setRemoteVisible(false); setConnection(""); setQueue(null); setPhase("idle")
    setGarment(current => current && current.status !== "live" ? { ...current, status: "failed" } : current)
    if (reason) setNotice(reason)
  }, [])

  // Track the saved key / provider status, and stop the (billed) session when the tab is hidden or the room closes.
  useEffect(() => {
    const refreshStatus = () => {
      background<{ hasKey: boolean; apiProvider?: string; customApiName?: string; customApiEndpoint?: string }>("status")
        .then(value => {
          setHasKey(value.hasKey)
          setApiProvider(value.apiProvider || "decart")
          setCustomApiName(value.customApiName || "Custom API")
          setActiveEndpoint(value.customApiEndpoint || "")
          if (value.customApiEndpoint) {
            setInlineApiUrl(value.customApiEndpoint)
          }
        })
        .catch(() => setHasKey(false))
    }

    refreshStatus()

    const onStorage = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.apiKey || changes.apiProvider || changes.customApi) {
        refreshStatus()
        setNotice(null)
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    const onHidden = () => { if (document.hidden && streamRef.current) stop({ message: "Paused while you were away.", action: "restart" }) }
    const onUnload = () => stop()
    document.addEventListener("visibilitychange", onHidden)
    window.addEventListener("pagehide", onUnload)
    return () => { chrome.storage.onChanged.removeListener(onStorage); document.removeEventListener("visibilitychange", onHidden); window.removeEventListener("pagehide", onUnload); stop() }
  }, [stop])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // ---------- Framing guide ----------

  const enterFraming = useCallback(() => {
    holdStartRef.current = 0
    setHolding(false)
    setPhase("framing")
  }, [])

  const markFramed = useCallback(() => {
    framedRef.current = true
    setPhase("ready")
    framedWaitersRef.current.splice(0).forEach(resolve => resolve())
  }, [])

  /** Resolves once the user is framed (or skipped the guide), so garments dropped early wait their turn. */
  const waitUntilFramed = useCallback((session: number) => {
    if (framedRef.current) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      framedWaitersRef.current.push(() => session === sessionRef.current ? resolve() : reject(Error("stopped")))
    })
  }, [])

  /** Enable camera: open the webcam with Decart's preferred size, load the body tracker, start framing. */
  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return
    if (!hasKey) {
      setIsEditingApi(true)
      return
    }
    const session = ++sessionRef.current
    setPhase("starting")
    try {
      const fps = typeof model.fps === "number" ? { ideal: model.fps } : model.fps
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: model.width }, height: { ideal: model.height }, ...(fps ? { frameRate: fps } : {}), facingMode: "user" },
        audio: false
      })
      if (session !== sessionRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      stream.getVideoTracks()[0].onended = () => stop({ message: "Camera disconnected.", action: "restart" })
      const camera = cameraRef.current!
      camera.srcObject = stream
      await camera.play()
      if (!trackerRef.current) {
        try { trackerRef.current = await createPoseTracker(); setVisionReady(true) }
        catch (error) { console.warn("OpenWear framing guide unavailable", error) }
      }
      if (session !== sessionRef.current) return
      if (trackerRef.current) enterFraming()
      else markFramed()
    } catch (error) {
      if (session !== sessionRef.current) return
      stop(friendly(error))
    }
  }, [enterFraming, hasKey, markFramed, stop])

  const handleInlineSave = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setInlineError("")
    if (!inlineApiUrl.trim() && !inlineApiKey.trim()) {
      setInlineError("Please enter your API URL or Key")
      return
    }
    setInlineBusy(true)
    try {
      const res = await saveSimpleApi(inlineApiUrl, inlineApiKey)
      setHasKey(true)
      setApiProvider(res.provider)
      if (res.provider === "custom") {
        setActiveEndpoint(inlineApiUrl.trim())
      }
      setIsEditingApi(false)
      setTimeout(() => {
        void start()
      }, 100)
    } catch (err: any) {
      setInlineError(err?.message || "Could not save API")
    } finally {
      setInlineBusy(false)
    }
  }, [inlineApiUrl, inlineApiKey, start])

  const handleInlineDemo = useCallback(async () => {
    setInlineBusy(true)
    setInlineError("")
    try {
      await saveSimpleApi("dct_try-3_rSAGBJEwEakbsurBDzorqiBBeoXexdPWRMKmOnYoTEAeeVLDlykvcvgTdWcZlTsk")
      setHasKey(true)
      setApiProvider("decart")
      setIsEditingApi(false)
      setTimeout(() => {
        void start()
      }, 100)
    } catch (err: any) {
      setInlineError(err?.message || "Could not activate demo key")
    } finally {
      setInlineBusy(false)
    }
  }, [start])

  /** Opens the Decart realtime session with the first garment as its initial state. */
  const connect = useCallback(async (image: Blob, prompt: string, session: number) => {
    const token = await background<Token>("token")
    if (session !== sessionRef.current) throw Error("stopped")
    const client = createDecartClient({ apiKey: token.apiKey, telemetry: false, logger: noopLogger })
    const realtime = await client.realtime.connect(streamRef.current!, {
      model,
      mirror: true, // desktop webcams rarely report facingMode, so mirror explicitly (Decart best practice)
      ...(token.fastMode ? { speed: "fast" } : {}),
      initialState: { prompt: { text: prompt, enhance: true }, image },
      onRemoteStream: (remote: MediaStream) => {
        if (session !== sessionRef.current || !remoteRef.current) return
        remoteRef.current.srcObject = remote
        remoteRef.current.play().catch(() => {})
      }
    })
    if (session !== sessionRef.current) { realtime.disconnect(); throw Error("stopped") }
    realtime.on("connectionChange", (state: string) => {
      if (session !== sessionRef.current) return
      setConnection(state)
      if (state === "generating" || state === "connected") setQueue(null)
      if (state === "disconnected") stop({ message: "The try-on session ended.", action: "restart" })
    })
    realtime.on("queuePosition", (position: { position: number; queueSize: number }) => { if (session === sessionRef.current) setQueue(position) })
    realtime.on("sessionEnded", (event: { reason: string }) => { if (session === sessionRef.current) stop({ message: `Session ended${event?.reason ? ` (${event.reason})` : ""}.`, action: "restart" }) })
    realtime.on("error", (error: any) => { if (session === sessionRef.current) stop(friendly(error)) })
    connectionRef.current = realtime
    setConnection(realtime.getConnectionState?.() || "connected")
    // Realtime video is billed per second, so enforce the session limit from settings.
    const started = Date.now()
    setRemaining(token.sessionSeconds)
    timerRef.current = setInterval(() => {
      const left = Math.max(0, token.sessionSeconds - Math.floor((Date.now() - started) / 1000))
      setRemaining(left)
      if (!left) stop({ message: "Session limit reached. Start again whenever you like.", action: "restart" })
    }, 1000)
    return realtime
  }, [stop])

  // ---------- Garment pipeline ----------

  const waitForRemoteFrame = () => new Promise<void>(resolve => {
    const video = remoteRef.current
    if (!video) return resolve()
    if (video.readyState >= 2 && video.videoWidth) return resolve()
    const done = () => { video.removeEventListener("loadeddata", done); resolve() }
    video.addEventListener("loadeddata", done)
  })

  /** Puts a prepared garment on the user: first one connects, later ones swap in with set(). */
  const apply = useCallback(async (id: number, image: Blob) => {
    const session = sessionRef.current
    await waitUntilFramed(session)
    const current = garmentRef.current
    if (session !== sessionRef.current || current?.id !== id) return
    // Read the name after framing so a rename made while waiting is honoured.
    const prompt = buildPrompt(current.name)
    updateGarment(id, { status: "fitting" })
    scanRef.current = { mode: "loop", start: performance.now(), revealRemote: false }
    const firstLook = !remoteShownRef.current

    // ---------- Custom API Pipeline Branch ----------
    if (apiProviderRef.current === "custom") {
      const camera = cameraRef.current
      if (!camera || !camera.videoWidth) throw new Error("Camera feed is not ready")
      const canvas = document.createElement("canvas")
      canvas.width = camera.videoWidth
      canvas.height = camera.videoHeight
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(camera, 0, 0)
      const personDataUrl = canvas.toDataURL("image/jpeg", 0.92)

      const garmentDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(image)
      })

      const resultImage = await background<string>("tryon-custom-api", {
        personDataUrl,
        garmentDataUrl,
        prompt,
        garmentName: current.name
      })

      if (session !== sessionRef.current || garmentRef.current?.id !== id) return
      setCustomResultImage(resultImage)
      await new Promise(resolve => setTimeout(resolve, 500))
      scanRef.current = { mode: "reveal", start: performance.now(), revealRemote: firstLook }
      if (firstLook) { remoteShownRef.current = true; setRemoteVisible(true) }
      setConnection("connected")
      updateGarment(id, { status: "live" })
      return
    }

    // ---------- Decart WebRTC Pipeline Branch ----------
    if (!connectionRef.current) {
      // If another garment is already connecting, wait for it, then swap this one in.
      if (!connectingRef.current) { connectingRef.current = connect(image, prompt, session); connectingForRef.current = id }
      try { await connectingRef.current }
      catch (error) { if (session === sessionRef.current) connectingRef.current = null; throw error }
      if (connectingForRef.current !== id) await connectionRef.current?.set({ prompt, image, enhance: true })
    } else {
      await connectionRef.current.set({ prompt, image, enhance: true })
    }
    await waitForRemoteFrame()
    await new Promise(resolve => setTimeout(resolve, firstLook ? SETTLE_MS + 500 : SETTLE_MS))
    if (session !== sessionRef.current || garmentRef.current?.id !== id) return
    scanRef.current = { mode: "reveal", start: performance.now(), revealRemote: firstLook }
    if (firstLook) { remoteShownRef.current = true; setRemoteVisible(true) }
    updateGarment(id, { status: "live" })
  }, [connect, updateGarment, waitUntilFramed])

  /** Entry point for every garment: load and normalise the image, then apply it. */
  const tryOn = useCallback(async (incoming: Incoming) => {
    setNotice(null); setDragging(false)
    const id = ++garmentSeqRef.current
    const name = cleanName(incoming.name || "")
    setGarment({ id, name, preview: "", status: "reading" })
    if (phaseRef.current === "idle") void start()
    // The scan only runs once the user is framed; apply() starts it.
    try {
      const prepared = incoming.file ? await normalizeImage(incoming.file) : await normalizeImage(await background<string>("image", { url: incoming.url }))
      if (garmentRef.current?.id !== id) return
      imageRef.current = prepared.blob
      updateGarment(id, { preview: prepared.preview, status: phaseRef.current === "ready" ? "fitting" : "waiting" })
      await apply(id, prepared.blob)
    } catch (error: any) {
      if (error?.message === "stopped") return
      if (garmentRef.current?.id === id) updateGarment(id, { status: "failed" })
      scanRef.current = { mode: "off", start: 0, revealRemote: false }
      setNotice(friendly(error))
    }
  }, [apply, start, updateGarment])

  /** Renaming the garment re-sends it, since the name is part of the Decart prompt. */
  const rename = useCallback((name: string) => {
    const current = garmentRef.current
    if (!current) return
    const next = { ...current, name }
    setGarment(next); garmentRef.current = next
    // A garment still loading, waiting or fitting picks up the change on its own.
    if (!imageRef.current || !streamRef.current || !["live", "failed"].includes(current.status)) return
    void apply(next.id, imageRef.current).catch(error => { if (error?.message !== "stopped") setNotice(friendly(error)) })
  }, [apply])

  const applyLookbook = async (item: LookbookItem) => {
    try {
      setShowLookbook(false)
      const dataUrl = item.getDataUrl()
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      void tryOn({ file: blob, name: item.name })
    } catch (err) {
      console.error("Failed to load lookbook item", err)
    }
  }

  const cycleMood = () => {
    const moods: ("natural" | "warm" | "high-contrast" | "editorial")[] = ["natural", "warm", "high-contrast", "editorial"]
    const nextIndex = (moods.indexOf(studioMood) + 1) % moods.length
    setStudioMood(moods[nextIndex])
  }

  // Garments dragged on the host page arrive from the content script.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || typeof event.data !== "object" || !event.data) return
      if (event.data.type === "openwear:drag") setDragging(!!event.data.active)
      if (event.data.type === "openwear:garment") void tryOn({ file: event.data.file instanceof Blob ? event.data.file : undefined, url: typeof event.data.url === "string" ? event.data.url : undefined, name: typeof event.data.name === "string" ? event.data.name : "" })
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [tryOn])

  // ---------- Vision + scan effect loop ----------
  // One requestAnimationFrame loop: runs pose detection (~15 fps) while framing or scanning, feeds the
  // framing guide, and draws the laser scan. The scan either loops while Decart works ("loop") or does
  // a single top-to-bottom sweep that reveals the AI video underneath ("reveal").

  useEffect(() => {
    let frame = 0, lastDetect = 0
    const fx = document.createElement("canvas")
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const camera = cameraRef.current, canvas = fxRef.current, tracker = trackerRef.current
      if (!camera || !canvas || !streamRef.current || !camera.videoWidth) return
      const scan = scanRef.current
      const framing = phaseRef.current === "framing"
      if (tracker && (framing || scan.mode !== "off") && now - lastDetect > 66) {
        lastDetect = now
        poseRef.current = tracker.detect(camera)
      }
      const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(2, devicePixelRatio || 1)
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = fx.width = Math.round(width * dpr)
        canvas.height = fx.height = Math.round(height * dpr)
      }
      const geometry = { width, height, videoWidth: camera.videoWidth, videoHeight: camera.videoHeight }
      if (framing && tracker) {
        const result = guide(poseRef.current, geometry)
        setGuidance(previous => previous.message === result.message && previous.ok === result.ok ? previous : result)
        if (result.ok) {
          holdStartRef.current ||= now
          setHolding(true)
          if (now - holdStartRef.current > HOLD_MS) markFramed()
        } else if (holdStartRef.current) { holdStartRef.current = 0; setHolding(false) }
      }
      const context = canvas.getContext("2d")!
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      const remote = customResultImage ? remoteImgRef.current : remoteRef.current
      if (scan.mode === "off") { if (remote && scan.revealRemote === false) remote.style.clipPath = ""; return }

      const elapsed = now - scan.start
      let y: number, intensity = 1
      if (scan.mode === "loop") {
        const phase = (elapsed % 2400) / 2400
        const eased = 0.5 - Math.cos(phase * Math.PI * 2) / 2
        y = height * (0.04 + 0.92 * eased)
        intensity = Math.min(1, elapsed / 300)
      } else {
        const progress = Math.min(1, elapsed / SCAN_REVEAL_MS)
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
        y = height * eased
        intensity = progress > 0.85 ? (1 - progress) / 0.15 : 1
        if (remote) remote.style.clipPath = scan.revealRemote ? `inset(0 0 ${Math.max(0, 100 - (y / height) * 100)}% 0)` : ""
        if (progress >= 1) { scanRef.current = { mode: "off", start: 0, revealRemote: false }; if (remote) remote.style.clipPath = ""; return }
      }

      // Body-conforming glow: draw the scan band, then keep only the pixels inside the person mask.
      const fxContext = fx.getContext("2d")!
      fxContext.setTransform(dpr, 0, 0, dpr, 0, 0)
      fxContext.globalCompositeOperation = "source-over"
      fxContext.clearRect(0, 0, width, height)
      const wake = scan.mode === "reveal" ? Math.min(y, 220) : 150
      const wakeGradient = fxContext.createLinearGradient(0, y - wake, 0, y)
      wakeGradient.addColorStop(0, "rgba(90,255,230,0)")
      wakeGradient.addColorStop(1, "rgba(120,255,238,0.34)")
      fxContext.fillStyle = wakeGradient
      fxContext.fillRect(0, y - wake, width, wake)
      fxContext.fillStyle = "rgba(210,255,250,0.22)"
      for (let line = y - wake; line < y; line += 5) fxContext.fillRect(0, line, width, 1)
      fxContext.fillStyle = "rgba(160,255,245,0.16)"
      for (let column = (elapsed / 40) % 18; column < width; column += 18) fxContext.fillRect(column, y - wake * 0.6, 1, wake * 0.6)
      const band = fxContext.createLinearGradient(0, y - 22, 0, y + 22)
      band.addColorStop(0, "rgba(120,255,240,0)")
      band.addColorStop(0.5, "rgba(235,255,253,0.95)")
      band.addColorStop(1, "rgba(120,255,240,0)")
      fxContext.fillStyle = band
      fxContext.fillRect(0, y - 22, width, 44)
      for (let spark = 0; spark < 36; spark++) {
        fxContext.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`
        fxContext.fillRect(Math.random() * width, y - 16 + Math.random() * 20, 2, 2)
      }
      if (tracker && poseRef.current) {
        const cover = coverRect(geometry)
        fxContext.globalCompositeOperation = "destination-in"
        fxContext.save()
        fxContext.translate(width, 0); fxContext.scale(-1, 1)
        fxContext.imageSmoothingEnabled = true
        fxContext.filter = "blur(2px)"
        fxContext.drawImage(tracker.mask, cover.x, cover.y, cover.width, cover.height)
        fxContext.restore()
        fxContext.filter = "none"
      }
      context.globalAlpha = intensity
      context.drawImage(fx, 0, 0)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      // The scanner beam itself spans the whole frame, a thin laser over the masked glow.
      context.shadowColor = "rgba(110,255,236,0.95)"
      context.shadowBlur = 14
      context.fillStyle = "rgba(225,255,252,0.9)"
      context.fillRect(0, y - 1, width, 2)
      context.shadowBlur = 0
      context.fillStyle = "rgba(130,255,240,0.85)"
      context.fillRect(8, y - 6, 3, 12)
      context.fillRect(width - 11, y - 6, 3, 12)
      context.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [markFramed])

  // ---------- Actions ----------

  /** Saves the current AI frame as a JPEG with flash effect & watermark. */
  const snapshot = () => {
    const img = remoteImgRef.current
    const video = remoteRef.current || cameraRef.current
    if (customResultImage && img) {
      setFlashing(true)
      setTimeout(() => setFlashing(false), 450)
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth || 720
      canvas.height = img.naturalHeight || 1280
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(img, 0, 0)

      // Minimal Watermark
      ctx.save()
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)"
      ctx.fillRect(canvas.width - 280, canvas.height - 56, 260, 40)

      ctx.fillStyle = "#ffffff"
      ctx.font = "600 14px Inter, sans-serif"
      ctx.fillText("PRUWEAR", canvas.width - 266, canvas.height - 34)

      ctx.fillStyle = "rgba(255, 255, 255, 0.5)"
      ctx.font = "11px Inter, sans-serif"
      ctx.fillText(apiProvider === "custom" ? (customApiName || "Custom API") : "Virtual Try-On", canvas.width - 266, canvas.height - 22)
      ctx.restore()

      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob), anchor = document.createElement("a")
        anchor.href = url; anchor.download = `pruwear-fit-${Date.now()}.jpg`; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, "image/jpeg", 0.95)
      return
    }

    if (!video?.videoWidth) return
    setFlashing(true)
    setTimeout(() => setFlashing(false), 450)
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(video, 0, 0)

    // Minimal Watermark
    ctx.save()
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)"
    ctx.fillRect(canvas.width - 280, canvas.height - 56, 260, 40)

    ctx.fillStyle = "#ffffff"
    ctx.font = "600 14px Inter, sans-serif"
    ctx.fillText("PRUWEAR", canvas.width - 266, canvas.height - 34)

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)"
    ctx.font = "11px Inter, sans-serif"
    ctx.fillText("Virtual Try-On", canvas.width - 266, canvas.height - 22)
    ctx.restore()

    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob), anchor = document.createElement("a")
      anchor.href = url; anchor.download = `pruwear-fit-${Date.now()}.jpg`; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, "image/jpeg", 0.95)
  }

  const onNoticeAction = () => {
    if (notice?.action === "settings") openOptions()
    if (notice?.action === "grant") window.open(chrome.runtime.getURL("tabs/room.html?grant=1"), "_blank")
    if (notice?.action === "restart") { setNotice(null); void start() }
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const incoming = parseDrop(event.dataTransfer)
    if (incoming) void tryOn(incoming)
    else setNotice({ message: "Drop a product image or image link." })
  }

  // ---------- Render ----------

  const box = silhouetteBox(size.width, size.height)
  const statusText: Record<GarmentStatus, string> = {
    reading: "Reading garment…",
    waiting: phase === "framing" ? "Position inside outline" : "Start camera to fit",
    fitting: apiProvider === "custom"
      ? "Processing via Custom API…"
      : (queue ? `AI Engine Queue · #${queue.position} of ${queue.queueSize}` : "Tailoring in real-time…"),
    live: apiProvider === "custom" ? "Custom API Fit" : "Live AI Fit",
    failed: "Fit failed"
  }
  const live = remoteVisible && (connection === "generating" || connection === "connected")
  const cameraOn = phase !== "idle" && phase !== "starting"

  return <div className={`room ${dragging ? "is-dragging" : ""}`} onDragEnter={e => { e.preventDefault(); setDragging(true) }} onDragOver={e => e.preventDefault()} onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }} onDrop={onDrop}>
    <div className={`stage mood-${studioMood}`} ref={stageRef}>
      <video className="camera" ref={cameraRef} muted playsInline />
      <video className={`remote ${remoteVisible && !customResultImage ? "visible" : ""}`} ref={remoteRef} muted playsInline />
      {customResultImage && (
        <img
          className={`remote ${remoteVisible ? "visible" : ""}`}
          ref={remoteImgRef}
          src={customResultImage}
          alt="Virtual Try-On Result"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 1
          }}
        />
      )}
      <canvas className="fx" ref={fxRef} />

      {flashing && <div className="camera-flash" />}

      {/* Framing corners (hidden in minimal mode via CSS) */}
      <div className="hud-corner hud-tl" />
      <div className="hud-corner hud-tr" />
      <div className="hud-corner hud-bl" />
      <div className="hud-corner hud-br" />

      {/* Top HUD Status Bar */}
      {cameraOn && (
        <div className="hud-top-bar">
          <div className="hud-status-live">
            <span className="pulse-dot" />
            <span>{live ? "LIVE" : connection === "generating" ? "FITTING" : "READY"}</span>
          </div>
          <span className="hud-model-pill">
            {apiProvider === "custom" ? (customApiName || "CUSTOM API") : "LUCY 3.5"}
          </span>
          {remaining > 0 && apiProvider !== "custom" && (
            <div className="hud-timer">
              <span>⏱</span>
              <span>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>
            </div>
          )}
        </div>
      )}

      {/* Lookbook Drawer */}
      {showLookbook && (
        <div className="lookbook-drawer">
          <div className="lookbook-header">
            <span className="lookbook-title">Lookbook</span>
            <button className="lookbook-close" onClick={() => setShowLookbook(false)}>✕</button>
          </div>
          <div className="lookbook-grid">
            {LOOKBOOK_ITEMS.map(item => (
              <div key={item.id} className="lookbook-card" onClick={() => void applyLookbook(item)}>
                <div className="lookbook-thumb" style={{ background: `linear-gradient(135deg, ${item.color}40, rgba(255,255,255,0.05))` }}>
                  {item.style === "jacket" ? "🧥" : item.style === "hoodie" ? "🥋" : item.style === "trench" ? "🥼" : "👔"}
                </div>
                <span className="lookbook-card-name">{item.name}</span>
                <span className="lookbook-card-tag">{item.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "framing" && size.width > 0 && (
        <div className={`framing ${holding ? "holding" : ""}`}>
          <div className="framing-vignette" />

          {/* Luxury Studio Optical Viewfinder SVG */}
          <svg width={size.width} height={size.height} className="viewfinder-svg" aria-hidden="true">
            {(() => {
              const frameW = Math.min(size.width * 0.68, 360)
              const frameH = Math.min(size.height * 0.80, 480)
              const x = (size.width - frameW) / 2
              const y = (size.height - frameH) / 2 + 10
              const arm = 24

              return (
                <g className="viewfinder-group">
                  {/* Subtle outer dashed bounding box */}
                  <rect x={x} y={y} width={frameW} height={frameH} className="vf-rect" rx={2} />

                  {/* High-end corner reticles (brackets) */}
                  <path d={`M ${x} ${y + arm} L ${x} ${y} L ${x + arm} ${y}`} className="vf-reticle" />
                  <path d={`M ${x + frameW - arm} ${y} L ${x + frameW} ${y} L ${x + frameW} ${y + arm}`} className="vf-reticle" />
                  <path d={`M ${x} ${y + frameH - arm} L ${x} ${y + frameH} L ${x + arm} ${y + frameH}`} className="vf-reticle" />
                  <path d={`M ${x + frameW - arm} ${y + frameH} L ${x + frameW} ${y + frameH} L ${x + frameW} ${y + frameH - arm}`} className="vf-reticle" />

                  {/* Vertical Center Axis */}
                  <line x1={size.width / 2} y1={y + 16} x2={size.width / 2} y2={y + frameH - 16} className="vf-axis-vert" />

                  {/* Head Target Ring */}
                  <circle cx={size.width / 2} cy={y + frameH * 0.22} r={Math.min(frameW * 0.20, 68)} className="vf-head-ring" />
                  <text x={size.width / 2} y={y + frameH * 0.22 - Math.min(frameW * 0.20, 68) - 8} className="vf-label" textAnchor="middle">HEAD ALIGNMENT</text>

                  {/* Shoulder Level Alignment Line */}
                  <line x1={x + 24} y1={y + frameH * 0.46} x2={x + frameW - 24} y2={y + frameH * 0.46} className="vf-shoulder-line" />
                  <text x={x + 32} y={y + frameH * 0.46 - 6} className="vf-label" textAnchor="start">SHOULDERS</text>

                  {/* Center Precision Target Crosshair */}
                  <line x1={size.width / 2 - 8} y1={y + frameH * 0.5} x2={size.width / 2 + 8} y2={y + frameH * 0.5} className="vf-crosshair" />
                  <line x1={size.width / 2} y1={y + frameH * 0.5 - 8} x2={size.width / 2} y2={y + frameH * 0.5 + 8} className="vf-crosshair" />
                </g>
              )
            })()}
          </svg>

          {/* Studio HUD Panel */}
          <div className="framing-hud">
            <div className="hud-badge">
              <span className={`status-dot ${holding ? "lock" : ""}`} />
              <span>STUDIO ALIGNMENT</span>
            </div>

            <div className="guidance-card">
              <strong key={guidance.message}>
                {guidance.ok ? "CALIBRATED — HOLD POSITION" : guidance.message.toUpperCase()}
              </strong>
              <span className="guidance-sub">
                {holding ? "Locking pose for virtual fitting…" : "Position head in upper ring & shoulders on reference line"}
              </span>

              {holding && (
                <div className="lock-progress">
                  <div className="lock-progress-bar" />
                </div>
              )}
            </div>

            <button className="skip-btn" onClick={markFramed}>
              <span>SKIP ALIGNMENT</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      )}

      {phase === "idle" && <div className="intro">
        <div className="intro-badge">Virtual Try-On Studio</div>
        <div className="intro-logo-wrap">
          <img src={logoUrl} alt="Pruwear" />
        </div>
        <h1>Pruwear</h1>
        <p className="intro-sub">Virtual Fitting Room</p>
        <p className="intro-tagline">Try any garment in real-time before you buy. Powered by AI.</p>

        {(!hasKey || isEditingApi) ? (
          <div className="room-direct-card">
            <div className="room-direct-header">
              <span className="room-direct-tag">CONNECT YOUR API</span>
              {hasKey && (
                <button type="button" className="room-direct-cancel" onClick={() => setIsEditingApi(false)}>✕ Cancel</button>
              )}
            </div>
            <p className="room-direct-desc">
              Paste your API URL or model endpoint below:
            </p>
            <form onSubmit={handleInlineSave} className="room-direct-form">
              <input
                type="text"
                className="room-direct-input"
                placeholder="API URL (e.g. http://localhost:8000/api/tryon)"
                value={inlineApiUrl}
                onChange={e => { setInlineApiUrl(e.target.value); setInlineError("") }}
                autoFocus
              />
              <input
                type="password"
                className="room-direct-input"
                placeholder="API Key / Token (leave blank if none)"
                value={inlineApiKey}
                onChange={e => { setInlineApiKey(e.target.value); setInlineError("") }}
              />
              {inlineError && <p className="room-direct-error">{inlineError}</p>}
              <button type="submit" className="primary highlight" disabled={inlineBusy} style={{ width: "100%", marginTop: 4 }}>
                {inlineBusy ? "Connecting…" : "Save API & Start Fitting"}
              </button>
              <button type="button" className="room-direct-demo" onClick={handleInlineDemo}>
                ✦ Or use cloud demo key
              </button>
            </form>
          </div>
        ) : (
          <div className="room-active-group">
            <div className="room-active-pill">
              <span className="room-active-dot" />
              <span className="room-active-title" title={activeEndpoint || customApiName}>
                {apiProvider === "custom" ? (activeEndpoint || customApiName || "Custom API") : "Lucy 3.5 Engine"}
              </span>
              <button type="button" className="room-active-change" onClick={() => setIsEditingApi(true)}>
                Change
              </button>
            </div>
            <button className="primary" onClick={() => void start()} disabled={hasKey === null}>
              Start Fitting
            </button>
          </div>
        )}

        <ul className="intro-steps">
          <li><b>1</b>Enable your camera</li>
          <li><b>2</b>Align your body outline</li>
          <li><b>3</b>Drop a garment image or browse the lookbook</li>
        </ul>

        <button className="intro-settings-link" onClick={openOptions} type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
          <span>Settings & Custom API</span>
        </button>

        <small>Your video stream is processed peer-to-peer and never stored.</small>
      </div>}

      {phase === "starting" && (
        <div className="intro loading">
          <div className="spinner-glow" />
          <span>{visionReady ? "Initializing video mirror…" : "Calibrating camera & pose model…"}</span>
        </div>
      )}

      {garment && <div className={`garment-card status-${garment.status}`}>
        <div className="garment-thumb">{garment.preview ? <img src={garment.preview} alt="" /> : <span className="thumb-skeleton" />}{["reading", "fitting"].includes(garment.status) && <i className="thumb-scan" />}</div>
        <div className="garment-meta">
          {editingName
            ? <input autoFocus defaultValue={garment.name} placeholder="e.g. oversized leather jacket" onBlur={e => { setEditingName(false); if (e.target.value.trim() !== garment.name) rename(cleanName(e.target.value)) }} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} />
            : <button className="garment-name" onClick={() => setEditingName(true)} title="Rename garment">{garment.name || "Custom Look"}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z" /></svg></button>}
          <span className="garment-status"><i className="pulse-dot" />{statusText[garment.status]}</span>
        </div>
      </div>}

      {cameraOn && <div className="toolbar">
        {live && (
          <button className="tool-btn primary-tool" onClick={snapshot} title="Capture Snapshot Photo" aria-label="Capture Snapshot Photo">
            <svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" /><circle cx="12" cy="13.5" r="3.3" /></svg>
          </button>
        )}
        {apiProvider === "custom" && live && (
          <button
            className="tool-btn"
            onClick={() => {
              if (garmentRef.current && imageRef.current) {
                void apply(garmentRef.current.id, imageRef.current)
              }
            }}
            title="Re-fit Current Pose"
            aria-label="Re-fit Current Pose"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          </button>
        )}
        <button className={`tool-btn ${showLookbook ? "active-tool" : ""}`} onClick={() => setShowLookbook(v => !v)} title="Lookbook" aria-label="Lookbook">
          <svg viewBox="0 0 24 24"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" /></svg>
        </button>
        <button className="tool-btn" onClick={cycleMood} title={`Lighting: ${studioMood}`} aria-label="Cycle lighting mood">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
        </button>
        <button className="tool-btn" onClick={openOptions} title="Options & Settings" aria-label="Settings">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
        </button>
        <button className="tool-btn" onClick={() => stop()} title="Turn Off Mirror" aria-label="Turn camera off">
          <svg viewBox="0 0 24 24"><path d="M12 3v8" /><path d="M6.3 6.8a8 8 0 1 0 11.4 0" /></svg>
        </button>
      </div>}

      {phase !== "starting" && phase !== "framing" && (
        <div className="bottom-dock">
          <button className="dock-lookbook-btn" onClick={() => setShowLookbook(v => !v)}>
            <span>Lookbook</span>
          </button>
          <button className="drop-pill" onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg>
            <span>{dragging ? "Drop to try on" : "Upload image"}</span>
          </button>
        </div>
      )}
      {dragging && <div className="drop-glow" />}

      {connection === "reconnecting" && <div className="banner">Reconnecting…</div>}
      {notice && <div className="notice" role="alert"><span>{notice.message}</span>{notice.action && <button onClick={onNoticeAction}>{notice.action === "settings" ? "Settings" : notice.action === "grant" ? "Allow Camera" : "Restart"}</button>}<button className="close" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button></div>}
    </div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void tryOn({ file, name: nameFromFile(file) }); e.target.value = "" }} />
  </div>
}

export default function RoomPage() {
  return isGrantPage ? <GrantPage /> : <Room />
}

// Haute Couture Studio Settings, Custom API Upload & AI Engine Activation
import { useEffect, useRef, useState } from "react"
import {
  DEFAULT_SETTINGS,
  DEFAULT_CUSTOM_API,
  loadSettings,
  saveSettings,
  validateCustomApiConfig,
  parseUploadedApiConfig,
  getSampleApiConfigTemplate,
  getSamplePythonFastAPICode,
  type Settings,
  type CustomApiConfig,
  type ApiProvider
} from "./lib/settings"
import logoUrl from "./assets/logo.png"
import "./options.css"

type Reply = { ok: true; data?: any } | { ok: false; error: string }

const STORES = [
  { name: "Zara", url: "https://www.zara.com" },
  { name: "Myntra", url: "https://www.myntra.com" },
  { name: "ASOS", url: "https://www.asos.com" },
  { name: "H&M", url: "https://www2.hm.com" },
  { name: "Amazon Fashion", url: "https://www.amazon.com/fashion" },
  { name: "Pinterest", url: "https://www.pinterest.com" },
]

export default function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [activeTab, setActiveTab] = useState<"custom-api" | "credentials" | "preferences" | "system">("custom-api")

  // Decart credentials state
  const [draftKey, setDraftKey] = useState("")
  const [revealKey, setRevealKey] = useState(false)
  const [decartStatus, setDecartStatus] = useState<{ tone: "ok" | "error" | "busy"; text: string } | null>(null)
  const [pasteNotice, setPasteNotice] = useState("")

  // Custom API state
  const [draftCustomApi, setDraftCustomApi] = useState<CustomApiConfig>(DEFAULT_CUSTOM_API)
  const [revealCustomKey, setRevealCustomKey] = useState(false)
  const [customApiStatus, setCustomApiStatus] = useState<{ tone: "ok" | "error" | "busy"; text: string } | null>(null)
  const [isDraggingJson, setIsDraggingJson] = useState(false)
  const [uploadNotice, setUploadNotice] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [copiedCodeNotice, setCopiedCodeNotice] = useState("")

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSettings().then(value => {
      setSettings(value)
      setDraftKey(value.apiKey)
      setDraftCustomApi(value.customApi || DEFAULT_CUSTOM_API)
      // If user has custom API already configured, open custom-api tab
      if (value.apiProvider === "custom") {
        setActiveTab("custom-api")
      }
    })
  }, [])

  const update = async (patch: Partial<Settings>) => {
    setSettings(current => ({ ...current, ...patch }))
    await saveSettings(patch)
  }

  // ---------- Engine Switching ----------

  const switchProvider = async (provider: ApiProvider) => {
    await update({ apiProvider: provider })
    if (provider === "custom") {
      setActiveTab("custom-api")
    } else {
      setActiveTab("credentials")
    }
  }

  // ---------- Custom API: Upload & Import JSON ----------

  const handleJsonFileSelected = async (file: File) => {
    if (!file) return
    try {
      const text = await file.text()
      const res = parseUploadedApiConfig(text)
      if (!res.success || !res.config) {
        setCustomApiStatus({ tone: "error", text: `Upload failed: ${res.error || "Invalid JSON"}` })
        return
      }

      const merged: CustomApiConfig = {
        ...draftCustomApi,
        ...res.config
      }

      setDraftCustomApi(merged)
      await update({ customApi: merged, apiProvider: "custom" })
      setUploadNotice(`✓ Successfully uploaded & loaded '${merged.name || "Custom API"}'!`)
      setTimeout(() => setUploadNotice(""), 3500)

      // Automatically trigger a connectivity test
      void testCustomConnection(merged)
    } catch (err: any) {
      setCustomApiStatus({ tone: "error", text: `Failed to read file: ${err?.message || "File error"}` })
    }
  }

  const handleDropJson = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingJson(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleJsonFileSelected(file)
  }

  const downloadTemplateJson = () => {
    const templateStr = getSampleApiConfigTemplate()
    const blob = new Blob([templateStr], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "pruwear-api-config.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportCurrentConfigJson = () => {
    const exportData = {
      $schema: "https://pruwear.ai/schemas/vton-api-v1.json",
      name: draftCustomApi.name,
      endpoint: draftCustomApi.endpoint,
      healthEndpoint: draftCustomApi.healthEndpoint,
      format: draftCustomApi.format,
      authType: draftCustomApi.authType,
      authHeaderName: draftCustomApi.authHeaderName,
      apiKey: draftCustomApi.apiKey,
      personField: draftCustomApi.personField,
      garmentField: draftCustomApi.garmentField,
      promptField: draftCustomApi.promptField,
      timeoutSeconds: draftCustomApi.timeoutSeconds
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `pruwear-${draftCustomApi.name.toLowerCase().replace(/\s+/g, "-") || "custom-api"}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyPythonCode = async () => {
    try {
      await navigator.clipboard.writeText(getSamplePythonFastAPICode())
      setCopiedCodeNotice("Python FastAPI server copied to clipboard ✓")
      setTimeout(() => setCopiedCodeNotice(""), 3000)
    } catch {
      setCopiedCodeNotice("Please copy code manually from Developer Specs")
      setTimeout(() => setCopiedCodeNotice(""), 3000)
    }
  }

  // ---------- Custom API: Test & Save ----------

  const testCustomConnection = async (configToTest = draftCustomApi) => {
    const validation = validateCustomApiConfig(configToTest)
    if (!validation.valid) {
      setCustomApiStatus({ tone: "error", text: validation.error || "Invalid endpoint URL" })
      return
    }

    setCustomApiStatus({ tone: "busy", text: `Testing connection to ${configToTest.endpoint}…` })

    try {
      const reply: Reply = await chrome.runtime.sendMessage({
        type: "test-custom-api",
        config: configToTest
      })

      if (reply?.ok) {
        setCustomApiStatus({
          tone: "ok",
          text: `✓ Connected! Status: ${reply.data?.status || 200} | Latency: ${reply.data?.latencyMs || 0}ms`
        })
      } else {
        const errText = (reply as { error?: string })?.error
        setCustomApiStatus({
          tone: "error",
          text: errText || "Could not reach custom API"
        })
      }
    } catch (err: any) {
      setCustomApiStatus({
        tone: "error",
        text: `Test failed: ${err?.message || "Extension runtime error"}`
      })
    }
  }

  const saveCustomApiConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const validation = validateCustomApiConfig(draftCustomApi)
    if (!validation.valid) {
      setCustomApiStatus({ tone: "error", text: validation.error || "Invalid endpoint" })
      return
    }

    await update({
      customApi: draftCustomApi,
      apiProvider: "custom"
    })

    setCustomApiStatus({
      tone: "ok",
      text: "✓ Saved! Custom API is now the active try-on engine for the fitting mirror."
    })
  }

  // ---------- Decart Keys ----------

  const handlePasteDecart = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setDraftKey(text.trim())
        if (decartStatus?.tone === "error") setDecartStatus(null)
        setPasteNotice("Pasted from clipboard ✓")
        setTimeout(() => setPasteNotice(""), 2000)
      }
    } catch {
      setPasteNotice("Clipboard permission needed")
      setTimeout(() => setPasteNotice(""), 2000)
    }
  }

  const handleUseDemoKey = () => {
    setDraftKey("dct_try-3_rSAGBJEwEakbsurBDzorqiBBeoXexdPWRMKmOnYoTEAeeVLDlykvcvgTdWcZlTsk")
    if (decartStatus?.tone === "error") setDecartStatus(null)
  }

  const saveDecartKey = async (event?: React.FormEvent) => {
    if (event) event.preventDefault()
    const key = draftKey.trim()

    if (!key) {
      await update({ apiKey: "" })
      setDecartStatus({ tone: "ok", text: "Key reset to default empty configuration." })
      return
    }

    if (key.length < 8) {
      setDecartStatus({ tone: "error", text: "Invalid key format. AI Engine keys must be at least 8 characters." })
      return
    }

    setDecartStatus({ tone: "busy", text: "Verifying credentials with Lucy VTON Neural Engine…" })

    try {
      const reply: Reply = await chrome.runtime.sendMessage({ type: "test-key", apiKey: key })
      if (!reply?.ok) {
        const error = (reply as { error?: string })?.error
        setDecartStatus({
          tone: "error",
          text: error === "KEY_REJECTED"
            ? "The AI Engine rejected this key. Please verify your credentials."
            : `Verification error: ${error || "Connection timed out"}`
        })
        return
      }
    } catch {
      // Standalone mode fallback
    }

    await update({ apiKey: key, apiProvider: "decart" })
    setDecartStatus({ tone: "ok", text: "✓ Key verified! Decart Lucy VTON is active." })
  }

  const disconnectDecartKey = async () => {
    setDraftKey("")
    await update({ apiKey: "" })
    setDecartStatus(null)
  }

  const openFittingRoom = () => {
    try {
      const roomUrl = chrome.runtime.getURL("tabs/room.html")
      chrome.tabs.create({ url: roomUrl })
    } catch {
      window.open("https://www.zara.com", "_blank")
    }
  }

  const isDecartLive = Boolean(settings.apiKey)
  const isCustomLive = Boolean(settings.customApi?.endpoint?.trim())
  const activeEngineLabel = settings.apiProvider === "custom" ? "Custom API" : "Decart Lucy 3.5"
  const isOverallLive = settings.apiProvider === "custom" ? isCustomLive : isDecartLive

  return (
    <div className="options-page">
      {/* ── FAR-LEFT: Rotated season spine ── */}
      <aside className="options-spine">
        <div className="spine-dot" />
        <div className="spine-text-wrapper">
          <span className="spine-text">Pruwear Studio · SS 2026</span>
        </div>
        <div className="spine-dot" />
      </aside>

      {/* ── MAIN CONTENT ── */}
      <div className="options-main">
        {/* Top bar */}
        <header className="options-topbar">
          <div className="options-brand-group">
            <div className="options-logo-box">
              <img src={logoUrl} alt="Pruwear" />
            </div>
            <div>
              <span className="options-wordmark">Pruwear</span>
              <span className="options-wordmark-sub">Atelier Numérique ✦</span>
            </div>
          </div>

          <div className="options-nav-actions">
            <nav className="options-tab-nav" role="tablist">
              <button
                type="button"
                className={`tab-link ${activeTab === "custom-api" ? "active" : ""}`}
                onClick={() => setActiveTab("custom-api")}
              >
                ✦ Custom API
              </button>
              <button
                type="button"
                className={`tab-link ${activeTab === "credentials" ? "active" : ""}`}
                onClick={() => setActiveTab("credentials")}
              >
                Decart Cloud
              </button>
              <button
                type="button"
                className={`tab-link ${activeTab === "preferences" ? "active" : ""}`}
                onClick={() => setActiveTab("preferences")}
              >
                Preferences
              </button>
              <button
                type="button"
                className={`tab-link ${activeTab === "system" ? "active" : ""}`}
                onClick={() => setActiveTab("system")}
              >
                System & Specs
              </button>
            </nav>

            <div className="nav-divider" />

            <div className={`status-pill ${isOverallLive ? "live" : "setup"}`}>
              <span className="status-dot" />
              <span>{isOverallLive ? `${activeEngineLabel} Online` : "Setup Required"}</span>
            </div>
          </div>
        </header>

        {/* ── BODY: Two-column editorial layout ── */}
        <div className="options-editorial-grid">
          {/* LEFT Column: Haute Couture Display */}
          <section className="editorial-left">
            <div>
              <div className="kicker-row">
                <span className="kicker-tag">
                  {settings.apiProvider === "custom"
                    ? "Custom Backend Engine · Self-Hosted / Remote"
                    : "Active Atelier · Lucy VTON 3.5 Realtime"}
                </span>
                <div className="kicker-line" />
              </div>

              <div className="editorial-headline">
                {activeTab === "custom-api" ? (
                  <>
                    <div className="headline-italic">Connect</div>
                    <div className="headline-italic">Your</div>
                    <div className="headline-bold">API.</div>
                  </>
                ) : (
                  <>
                    <div className="headline-italic">Connect</div>
                    <div className="headline-italic">Your</div>
                    <div className="headline-bold">Mirror.</div>
                  </>
                )}
              </div>

              <div className="editorial-narrative">
                <div className="narrative-accent-bar" />
                <p>
                  {activeTab === "custom-api"
                    ? "Upload your API configuration directly in the extension whenever your backend is finished. Supports Python FastAPI, Flask, Node.js, IDM-VTON, CatVTON, or any custom Virtual Try-On endpoint."
                    : "Unlock real-time WebRTC neural garment simulation. Sub-20ms mirror latency powered by Lucy VTON 3.5. The future of haute couture fitting, live on your browser screen."}
                </p>
              </div>
            </div>

            <div>
              {/* Step indicator */}
              <div className="step-progress-row">
                {[
                  { num: "001", label: "Build API", done: true },
                  { num: "002", label: "Upload & Test", done: isCustomLive, current: !isCustomLive },
                  { num: "003", label: "Mirror Ready", done: isOverallLive, next: !isOverallLive }
                ].map((item) => (
                  <div key={item.num} className="step-progress-item">
                    <div className="step-num-line">
                      <span className={`step-num ${item.done ? "done" : item.current ? "current" : "future"}`}>
                        {item.num}
                      </span>
                      {item.done && <span className="step-check">✓</span>}
                    </div>
                    <span className={`step-name ${item.done ? "done" : item.current ? "current" : "future"}`}>
                      {item.label}
                    </span>
                    {(item.current || item.done) && <div className={`step-active-bar ${item.done ? "done" : "current"}`} />}
                  </div>
                ))}
              </div>

              {/* Compatible Maisons */}
              <div className="maisons-section">
                <div className="maisons-title">Compatible Maisons & Retailers</div>
                <div className="maisons-grid">
                  {STORES.map(s => (
                    <a
                      key={s.name}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="maison-tag"
                    >
                      {s.name} <span className="arrow-icon">↗</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT Column: Active Panels by Tab */}
          <section className="editorial-right">
            {/* Global Engine Switcher Banner */}
            <div className="engine-switcher-card">
              <div className="engine-switcher-left">
                <span className="engine-switcher-title">Active Try-On Engine</span>
                <span className="engine-switcher-subtitle">
                  Choose which backend powers the live virtual fitting mirror
                </span>
              </div>
              <div className="engine-toggle-group">
                <button
                  type="button"
                  className={`engine-toggle-btn ${settings.apiProvider === "custom" ? "active" : ""}`}
                  onClick={() => switchProvider("custom")}
                >
                  <span>✦ Custom API</span>
                </button>
                <button
                  type="button"
                  className={`engine-toggle-btn ${settings.apiProvider === "decart" ? "active" : ""}`}
                  onClick={() => switchProvider("decart")}
                >
                  <span>Decart Cloud</span>
                </button>
              </div>
            </div>

            {/* TAB 1: CUSTOM API MANAGEMENT & UPLOAD */}
            {activeTab === "custom-api" && (
              <div className="panel-custom-api">
                {/* 1. Upload API Config Dropzone */}
                <div
                  className={`api-dropzone-card ${isDraggingJson ? "dragging" : ""}`}
                  onDragOver={e => { e.preventDefault(); setIsDraggingJson(true) }}
                  onDragLeave={() => setIsDraggingJson(false)}
                  onDrop={handleDropJson}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) void handleJsonFileSelected(file)
                      e.target.value = ""
                    }}
                  />
                  <div className="api-dropzone-icon">↑</div>
                  <h3 className="api-dropzone-title">Upload API Configuration (.json)</h3>
                  <p className="api-dropzone-subtitle">
                    Finished building your API? Drag and drop your <code>api-config.json</code> file here or click to upload. The extension will automatically import, test, and activate your backend.
                  </p>
                  <span className="api-dropzone-btn">
                    <span>Select JSON File</span>
                  </span>
                </div>

                {uploadNotice && (
                  <div className="api-feedback-banner ok">
                    <span>✓</span>
                    <span>{uploadNotice}</span>
                  </div>
                )}

                {/* Helper Toolbar: Download Template & Sample Server */}
                <div className="api-actions-toolbar">
                  <button type="button" className="api-tool-btn" onClick={downloadTemplateJson} title="Download JSON template">
                    <span>⬇ Download Template (.json)</span>
                  </button>
                  <button type="button" className="api-tool-btn" onClick={exportCurrentConfigJson} title="Export current config">
                    <span>⬆ Export Config (.json)</span>
                  </button>
                  <button type="button" className="api-tool-btn" onClick={copyPythonCode} title="Copy ready-to-run FastAPI Python server">
                    <span>📋 Copy Python FastAPI Server</span>
                  </button>
                </div>

                {copiedCodeNotice && (
                  <div className="api-feedback-banner ok">
                    <span>✓</span>
                    <span>{copiedCodeNotice}</span>
                  </div>
                )}

                {/* Status / Feedback Banner */}
                {customApiStatus && (
                  <div className={`api-feedback-banner ${customApiStatus.tone}`}>
                    <span>{customApiStatus.tone === "ok" ? "✓" : customApiStatus.tone === "busy" ? "⏳" : "⚠"}</span>
                    <span>{customApiStatus.text}</span>
                  </div>
                )}

                {/* 2. Interactive Form to Inspect & Edit Custom API */}
                <div className="panel-form-card">
                  <div className="form-heading-row">
                    <div className="card-heading-row">
                      <span className="card-step-num">✦</span>
                      <h3 className="card-heading">Custom API Configuration</h3>
                    </div>
                    {isCustomLive && (
                      <span className="status-pill live">
                        <span className="status-dot" />
                        <span>Connected</span>
                      </span>
                    )}
                  </div>

                  <form onSubmit={saveCustomApiConfig}>
                    <div className="form-grid-2">
                      <div className="form-field-group">
                        <label className="form-label" htmlFor="apiName">API Name / Label</label>
                        <input
                          id="apiName"
                          type="text"
                          className="form-input-text"
                          value={draftCustomApi.name}
                          onChange={e => setDraftCustomApi({ ...draftCustomApi, name: e.target.value })}
                          placeholder="e.g. My FastVITON Server"
                        />
                      </div>
                      <div className="form-field-group">
                        <label className="form-label" htmlFor="apiEndpoint">
                          Endpoint URL <span style={{ color: "var(--ruby)" }}>*</span>
                        </label>
                        <input
                          id="apiEndpoint"
                          type="text"
                          className="form-input-text"
                          value={draftCustomApi.endpoint}
                          onChange={e => {
                            setDraftCustomApi({ ...draftCustomApi, endpoint: e.target.value })
                            if (customApiStatus?.tone === "error") setCustomApiStatus(null)
                          }}
                          placeholder="e.g. http://localhost:8000/api/tryon"
                          required
                        />
                      </div>
                    </div>

                    <div className="form-field-group">
                      <label className="form-label" htmlFor="healthEndpoint">
                        Health Check URL (Optional Ping Test)
                      </label>
                      <input
                        id="healthEndpoint"
                        type="text"
                        className="form-input-text"
                        value={draftCustomApi.healthEndpoint}
                        onChange={e => setDraftCustomApi({ ...draftCustomApi, healthEndpoint: e.target.value })}
                        placeholder="e.g. http://localhost:8000/health"
                      />
                    </div>

                    <div className="form-field-group">
                      <label className="form-label">Authentication Type</label>
                      <div className="pill-selector">
                        <button
                          type="button"
                          className={`pill-choice-btn ${draftCustomApi.authType === "bearer" ? "selected" : ""}`}
                          onClick={() => setDraftCustomApi({ ...draftCustomApi, authType: "bearer" })}
                        >
                          Bearer Token
                        </button>
                        <button
                          type="button"
                          className={`pill-choice-btn ${draftCustomApi.authType === "header" ? "selected" : ""}`}
                          onClick={() => setDraftCustomApi({ ...draftCustomApi, authType: "header" })}
                        >
                          Custom Header
                        </button>
                        <button
                          type="button"
                          className={`pill-choice-btn ${draftCustomApi.authType === "none" ? "selected" : ""}`}
                          onClick={() => setDraftCustomApi({ ...draftCustomApi, authType: "none" })}
                        >
                          No Auth / Public
                        </button>
                      </div>
                    </div>

                    {draftCustomApi.authType !== "none" && (
                      <div className="form-grid-2">
                        {draftCustomApi.authType === "header" && (
                          <div className="form-field-group">
                            <label className="form-label" htmlFor="authHeaderName">Header Name</label>
                            <input
                              id="authHeaderName"
                              type="text"
                              className="form-input-text"
                              value={draftCustomApi.authHeaderName}
                              onChange={e => setDraftCustomApi({ ...draftCustomApi, authHeaderName: e.target.value })}
                              placeholder="e.g. X-API-Key"
                            />
                          </div>
                        )}
                        <div className="form-field-group" style={{ gridColumn: draftCustomApi.authType === "header" ? "auto" : "1 / -1" }}>
                          <label className="form-label" htmlFor="customApiKey">Secret Key / Token</label>
                          <div className="key-input-wrapper">
                            <input
                              id="customApiKey"
                              type={revealCustomKey ? "text" : "password"}
                              value={draftCustomApi.apiKey}
                              onChange={e => setDraftCustomApi({ ...draftCustomApi, apiKey: e.target.value })}
                              placeholder="Paste your API secret or token…"
                            />
                            <button
                              type="button"
                              onClick={() => setRevealCustomKey(v => !v)}
                              className="btn-reveal"
                            >
                              {revealCustomKey ? "Hide" : "Show"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="form-field-group">
                      <label className="form-label">Request Payload Protocol</label>
                      <div className="pill-selector">
                        <button
                          type="button"
                          className={`pill-choice-btn ${draftCustomApi.format === "rest-json" ? "selected" : ""}`}
                          onClick={() => setDraftCustomApi({ ...draftCustomApi, format: "rest-json" })}
                        >
                          JSON with Base64 Images (Recommended)
                        </button>
                        <button
                          type="button"
                          className={`pill-choice-btn ${draftCustomApi.format === "rest-form" ? "selected" : ""}`}
                          onClick={() => setDraftCustomApi({ ...draftCustomApi, format: "rest-form" })}
                        >
                          Multipart Form-Data (Binary Files)
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Advanced Field Mappings */}
                    <button
                      type="button"
                      className="advanced-toggle-btn"
                      onClick={() => setShowAdvanced(v => !v)}
                    >
                      <span>{showAdvanced ? "▼ Hide Advanced Field Mappings" : "▶ Show Advanced Field Mappings"}</span>
                    </button>

                    {showAdvanced && (
                      <div style={{ padding: "14px", background: "rgba(0,0,0,0.25)", borderRadius: "8px", marginBottom: "16px" }}>
                        <div className="form-grid-2">
                          <div className="form-field-group">
                            <label className="form-label" htmlFor="personField">Person Image Field</label>
                            <input
                              id="personField"
                              type="text"
                              className="form-input-text"
                              value={draftCustomApi.personField}
                              onChange={e => setDraftCustomApi({ ...draftCustomApi, personField: e.target.value })}
                              placeholder="default: person_image"
                            />
                          </div>
                          <div className="form-field-group">
                            <label className="form-label" htmlFor="garmentField">Garment Image Field</label>
                            <input
                              id="garmentField"
                              type="text"
                              className="form-input-text"
                              value={draftCustomApi.garmentField}
                              onChange={e => setDraftCustomApi({ ...draftCustomApi, garmentField: e.target.value })}
                              placeholder="default: garment_image"
                            />
                          </div>
                        </div>
                        <div className="form-grid-2">
                          <div className="form-field-group">
                            <label className="form-label" htmlFor="promptField">Prompt Field</label>
                            <input
                              id="promptField"
                              type="text"
                              className="form-input-text"
                              value={draftCustomApi.promptField}
                              onChange={e => setDraftCustomApi({ ...draftCustomApi, promptField: e.target.value })}
                              placeholder="default: prompt"
                            />
                          </div>
                          <div className="form-field-group">
                            <label className="form-label" htmlFor="timeoutSeconds">Timeout (Seconds)</label>
                            <input
                              id="timeoutSeconds"
                              type="number"
                              className="form-input-text"
                              value={draftCustomApi.timeoutSeconds}
                              onChange={e => setDraftCustomApi({ ...draftCustomApi, timeoutSeconds: Number(e.target.value) || 30 })}
                              placeholder="default: 30"
                              min="5"
                              max="180"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => void testCustomConnection()}
                        disabled={customApiStatus?.tone === "busy"}
                      >
                        {customApiStatus?.tone === "busy" ? "Testing…" : "⚡ Test Connection"}
                      </button>
                      <button
                        type="submit"
                        className="btn-activate"
                        style={{ flex: 1 }}
                      >
                        Save & Activate Custom API ✦
                      </button>
                    </div>
                  </form>

                  {isCustomLive && (
                    <div className="active-live-card" style={{ marginTop: "24px" }}>
                      <div className="active-top-row">
                        <div className="active-check-circle">✓</div>
                        <div>
                          <div className="active-title">{draftCustomApi.name || "Custom API"} Active</div>
                          <div className="active-meta">{draftCustomApi.endpoint}</div>
                        </div>
                      </div>
                      <p className="active-note">
                        Your custom virtual try-on API is connected and ready. Open any store or launch the mirror below to test!
                      </p>
                      <div className="active-actions-row">
                        <button type="button" onClick={openFittingRoom} className="btn-launch-mirror">
                          Launch Fitting Mirror ↗
                        </button>
                        <a href="https://www.zara.com" target="_blank" rel="noreferrer" className="btn-browse-store">
                          Try on Zara ↗
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: DECART CREDENTIALS */}
            {activeTab === "credentials" && (
              <div className="panel-credentials">
                {!isDecartLive && (
                  <div className="panel-step-card">
                    <div className="card-heading-row">
                      <span className="card-step-num">01.</span>
                      <h3 className="card-heading">Decart Lucy VTON Key</h3>
                    </div>
                    <p className="card-desc">
                      Your personal Decart key grants direct WebRTC access to the Lucy VTON 3.5 generative mirror engine.
                    </p>
                    <div className="card-action-row">
                      <a href="https://platform.decart.ai" target="_blank" rel="noreferrer" className="btn-outline">
                        Generate Instantly <span className="arrow-icon">↗</span>
                      </a>
                      <button type="button" onClick={handleUseDemoKey} className="btn-dashed">
                        ✦ Use Default Decart Key
                      </button>
                    </div>
                  </div>
                )}

                <div className="panel-form-card">
                  <div className="form-heading-row">
                    <div className="card-heading-row">
                      <span className="card-step-num">{isDecartLive ? "✦" : "02."}</span>
                      <h3 className="card-heading">
                        {isDecartLive ? "Decart Credentials Active" : "Activate Decart Cloud"}
                      </h3>
                    </div>
                    {isDecartLive && (
                      <button type="button" onClick={disconnectDecartKey} className="btn-disconnect">
                        Disconnect Key
                      </button>
                    )}
                  </div>

                  <div className="key-label-row">
                    <label htmlFor="apiKey" className="key-label">
                      Secret Decart AI Engine Key
                    </label>
                    {!isDecartLive && (
                      <div className="paste-actions">
                        {pasteNotice && <span className="paste-notice">{pasteNotice}</span>}
                        <button type="button" onClick={handlePasteDecart} className="btn-paste">
                          Paste Key
                        </button>
                      </div>
                    )}
                  </div>

                  <div className={`key-input-wrapper ${decartStatus?.tone === "error" ? "error" : isDecartLive ? "live" : ""}`}>
                    <input
                      id="apiKey"
                      type={revealKey ? "text" : "password"}
                      value={draftKey}
                      onChange={e => {
                        setDraftKey(e.target.value)
                        if (decartStatus?.tone === "error") setDecartStatus(null)
                      }}
                      disabled={isDecartLive}
                      placeholder="dct_try-3_••••••••••••••••••••"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" onClick={() => setRevealKey(v => !v)} className="btn-reveal">
                      {revealKey ? "Hide" : "Show"}
                    </button>
                  </div>

                  {decartStatus && (
                    <div className={`api-feedback-banner ${decartStatus.tone}`} style={{ marginTop: "12px" }}>
                      <span>{decartStatus.tone === "ok" ? "✓" : decartStatus.tone === "busy" ? "⏳" : "⚠"}</span>
                      <span>{decartStatus.text}</span>
                    </div>
                  )}

                  {!isDecartLive ? (
                    <button
                      type="button"
                      onClick={() => saveDecartKey()}
                      disabled={decartStatus?.tone === "busy"}
                      className="btn-activate"
                      style={{ marginTop: "16px" }}
                    >
                      {decartStatus?.tone === "busy" ? "Verifying with Neural Engine…" : "Activate Decart Cloud ✦"}
                    </button>
                  ) : (
                    <div className="active-live-card" style={{ marginTop: "20px" }}>
                      <div className="active-top-row">
                        <div className="active-check-circle">✓</div>
                        <div>
                          <div className="active-title">Decart Lucy VTON 3.5 Live</div>
                          <div className="active-meta">WebRTC Realtime Engine · Latency &lt;18ms</div>
                        </div>
                      </div>
                      <div className="active-actions-row">
                        <button type="button" onClick={openFittingRoom} className="btn-launch-mirror">
                          Test Mirror Stream ↗
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: PREFERENCES */}
            {activeTab === "preferences" && (
              <div className="panel-preferences">
                <div className="pref-card">
                  <div className="pref-header">
                    <h3>Engine Preferences</h3>
                    <p>Customize real-time simulation parameters and pipeline latency.</p>
                  </div>

                  <label className="pref-toggle-row">
                    <input
                      type="checkbox"
                      checked={settings.fastMode}
                      onChange={e => void update({ fastMode: e.target.checked })}
                    />
                    <div className="pref-toggle-content">
                      <span className="pref-toggle-title">Turbo Generation Mode</span>
                      <span className="pref-toggle-desc">Accelerated real-time frame synthesis for high-refresh displays.</span>
                    </div>
                  </label>

                  <div className="pref-divider" />

                  <div className="pref-locked-row">
                    <div>
                      <span className="pref-toggle-title">Max Cloud Fitting Duration</span>
                      <span className="pref-toggle-desc">15 seconds per WebRTC session to avoid token overuse on Decart cloud.</span>
                    </div>
                    <div className="locked-badge">
                      🔒 15s (Cloud Fixed)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: SYSTEM & DEVELOPER SPECS */}
            {activeTab === "system" && (
              <div className="panel-system">
                <div className="system-specs-card">
                  <div className="pref-header">
                    <h3>Atelier Engine Telemetry</h3>
                    <p>Live diagnostic metrics for your virtual try-on pipeline.</p>
                  </div>

                  <div className="system-telemetry-list">
                    <div className="telemetry-item">
                      <span className="telemetry-key">Active Try-On Engine</span>
                      <span className="telemetry-val highlight">
                        {settings.apiProvider === "custom" ? "Custom API Backend" : "Decart Lucy VTON 3.5"}
                      </span>
                    </div>
                    {settings.apiProvider === "custom" && (
                      <div className="telemetry-item">
                        <span className="telemetry-key">Custom Endpoint</span>
                        <span className="telemetry-val">{settings.customApi.endpoint || "Not configured"}</span>
                      </div>
                    )}
                    <div className="telemetry-item">
                      <span className="telemetry-key">Pose Estimation Engine</span>
                      <span className="telemetry-val">MediaPipe Pose Tracker (WASM SIMD)</span>
                    </div>
                    <div className="telemetry-item">
                      <span className="telemetry-key">Client Extension Version</span>
                      <span className="telemetry-val">Pruwear Haute Couture v1.0.0</span>
                    </div>
                  </div>
                </div>

                {/* Developer Guide Box */}
                <div className="system-specs-card" style={{ marginTop: "24px" }}>
                  <div className="pref-header">
                    <h3>Custom API Developer Specification</h3>
                    <p>How to format your backend server to receive and return virtual try-on requests.</p>
                  </div>

                  <div style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.6" }}>
                    <p><strong>Request Method:</strong> <code>POST [your_endpoint_url]</code></p>
                    <p><strong>Request Body (JSON Base64 Mode):</strong></p>
                    <div className="code-preview-box">
{`{
  "person_image": "data:image/jpeg;base64,...",
  "garment_image": "data:image/jpeg;base64,...",
  "prompt": "jacket or clothing category",
  "name": "garment title"
}`}
                    </div>

                    <p style={{ marginTop: "12px" }}><strong>Response Options:</strong></p>
                    <ul style={{ paddingLeft: "18px", marginTop: "4px" }}>
                      <li>Direct binary image: <code>content-type: image/jpeg</code></li>
                      <li>JSON with image field: <code>{`{ "image": "data:image/jpeg;base64,..." }`}</code> or <code>{`{ "image_url": "https://..." }`}</code></li>
                    </ul>

                    <p style={{ marginTop: "14px" }}><strong>Ready-to-run Python FastAPI Template:</strong></p>
                    <div className="code-preview-box">
                      <button type="button" className="code-copy-btn" onClick={copyPythonCode}>
                        Copy Code
                      </button>
                      <pre>{getSamplePythonFastAPICode()}</pre>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <footer className="options-editorial-footer">
              <span className="footer-copyright">
                © {new Date().getFullYear()} Pruwear Haute Couture · v1.0.0
              </span>
              <div className="footer-links">
                {["Privacy Architecture", "Security Protocol", "Support"].map(l => (
                  <span key={l} className="footer-link">{l}</span>
                ))}
              </div>
            </footer>
          </section>
        </div>
      </div>
    </div>
  )
}

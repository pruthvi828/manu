// Toolbar popup: direct API input & fitting room launcher

import { useEffect, useState } from "react"
import { loadSettings, saveSimpleApi, type Settings } from "./lib/settings"
import logoUrl from "./assets/logo.png"
import "./popup.css"

/** Asks the tab's content script to open the room, injecting the script first if needed */
async function openFittingRoom() {
  const type = "openwear:open"
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
    throw Error("Open any shopping site first (e.g. Zara, ASOS, Myntra, Amazon).")
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type })
  } catch {
    const script = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0]
    if (!script) throw Error("Extension content script is missing. Reload extension.")
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [script] })
      let sent = false
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await chrome.tabs.sendMessage(tab.id, { type }); sent = true; break }
        catch { await new Promise(resolve => setTimeout(resolve, 80)) }
      }
      if (!sent) throw Error("Refresh this shopping page and try again.")
    } catch (error: any) {
      throw Error(error.message?.includes("Cannot access") ? "This page does not allow overlays. Open an e-commerce store." : error.message || "Could not open fitting room.")
    }
  }
}

export default function Popup() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [isReady, setIsReady] = useState<boolean | null>(null)
  const [activeLabel, setActiveLabel] = useState("")
  const [isEditing, setIsEditing] = useState(false)

  // Direct simple inputs
  const [apiUrl, setApiUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [saveNotice, setSaveNotice] = useState("")

  const reloadStatus = async () => {
    const settings = await loadSettings()
    if (settings.apiProvider === "custom" && settings.customApi?.endpoint?.trim()) {
      setIsReady(true)
      setActiveLabel(settings.customApi.endpoint)
      setApiUrl(settings.customApi.endpoint)
      setApiKey(settings.customApi.apiKey || "")
    } else if (settings.apiProvider === "decart" && settings.apiKey?.trim()) {
      setIsReady(true)
      setActiveLabel("Decart Lucy 3.5 Engine")
      setApiKey(settings.apiKey)
    } else {
      setIsReady(false)
      setActiveLabel("")
    }
  }

  useEffect(() => {
    void reloadStatus()
  }, [])

  const handleQuickSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError("")

    if (!apiUrl.trim() && !apiKey.trim()) {
      setError("Please paste your API URL or Key")
      return
    }

    try {
      setBusy(true)
      await saveSimpleApi(apiUrl, apiKey)
      await reloadStatus()
      setIsEditing(false)
      setSaveNotice("✓ API Saved!")
      setTimeout(() => setSaveNotice(""), 2000)

      // Try opening room automatically
      try {
        await openFittingRoom()
        window.close()
      } catch {
        // Not on a shopping tab; keep popup open with success message
      }
    } catch (err: any) {
      setError(err?.message || "Could not save API")
    } finally {
      setBusy(false)
    }
  }

  const handleUseDemo = async () => {
    setBusy(true)
    setError("")
    try {
      await saveSimpleApi("dct_try-3_rSAGBJEwEakbsurBDzorqiBBeoXexdPWRMKmOnYoTEAeeVLDlykvcvgTdWcZlTsk")
      await reloadStatus()
      setIsEditing(false)
    } catch (err: any) {
      setError(err?.message || "Failed")
    } finally {
      setBusy(false)
    }
  }

  const openRoom = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await openFittingRoom()
      window.close()
    } catch (err: any) {
      setError(err?.message || "Could not reach this page")
    } finally {
      setBusy(false)
    }
  }

  const openAdvancedSettings = () => {
    chrome.runtime.sendMessage({ type: "open-options" }).catch(() => {
      chrome.runtime.openOptionsPage?.() || window.open(chrome.runtime.getURL("options.html"), "_blank")
    })
  }

  return (
    <main className="popup">
      <div className="popup-header">
        <div className="popup-brand">
          <div className="popup-logo-icon">
            <img src={logoUrl} alt="Pruwear" />
          </div>
          <div className="popup-title-group">
            <h2>Pruwear</h2>
            <span>Virtual Try-On</span>
          </div>
        </div>
        <span className={`popup-pill-tag ${isReady ? "ready" : "warn"}`}>
          {isReady ? "API READY" : "SETUP"}
        </span>
      </div>

      {saveNotice && (
        <div style={{ margin: "0 20px 10px", padding: "8px 12px", background: "rgba(16,185,129,0.15)", color: "#34d399", borderRadius: 4, fontSize: 11, textAlign: "center" }}>
          {saveNotice}
        </div>
      )}

      {/* 1. SIMPLE DIRECT INPUT FORM (Shown when not setup or when user clicked Change) */}
      {(!isReady || isEditing) && (
        <form className="popup-simple-card" onSubmit={handleQuickSave}>
          <div className="popup-simple-title">
            <span>Connect Your API</span>
            {isReady && (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                style={{ background: "none", border: "none", color: "#888", fontSize: 11, cursor: "pointer" }}
              >
                ✕ Cancel
              </button>
            )}
          </div>
          <p className="popup-simple-subtitle">
            Just paste your API endpoint URL or key below and click save.
          </p>

          <input
            type="text"
            className="popup-input-field"
            placeholder="API URL (e.g. http://localhost:8000/api/tryon)"
            value={apiUrl}
            onChange={e => { setApiUrl(e.target.value); setError("") }}
            autoFocus
          />

          <input
            type="password"
            className="popup-input-field"
            placeholder="API Key / Token (leave blank if none)"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setError("") }}
          />

          <button type="submit" className="popup-save-btn" disabled={busy}>
            {busy ? "Saving…" : "Save API & Start"}
          </button>

          <button type="button" className="popup-demo-link" onClick={handleUseDemo}>
            ✦ Or use default Decart cloud demo key
          </button>
        </form>
      )}

      {/* 2. CONNECTED READY STATE */}
      {isReady && !isEditing && (
        <>
          <div className="popup-connected-bar">
            <div className="popup-connected-text" title={activeLabel}>
              <span className="popup-connected-dot" />
              <span>{activeLabel.length > 28 ? `${activeLabel.slice(0, 28)}…` : activeLabel}</span>
            </div>
            <button
              type="button"
              className="popup-change-btn"
              onClick={() => setIsEditing(true)}
            >
              Change
            </button>
          </div>

          <div className="popup-actions">
            <button className="popup-action primary" disabled={busy} onClick={() => void openRoom()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>
              <span>{busy ? "Opening..." : "Open Fitting Room"}</span>
            </button>
          </div>
        </>
      )}

      <div className="popup-actions" style={{ paddingTop: 4 }}>
        <button className="popup-action secondary" onClick={openAdvancedSettings}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
          <span>Advanced Options</span>
        </button>
      </div>

      <p className="popup-hint">Open any fashion store (Zara, ASOS, Myntra) to try on clothes.</p>
      {error && <p role="alert" className="popup-error">{error}</p>}
    </main>
  )
}

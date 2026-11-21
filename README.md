# Pruwear ✦ Realtime Virtual Try-On Chrome Extension

> **Realtime AI Virtual Try-On Chrome Extension powered by Lucy VTON 3.5 & MediaPipe**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Plasmo](https://img.shields.io/badge/Built%20with-Plasmo-blue)](https://docs.plasmo.com/)
[![React](https://img.shields.io/badge/UI-React%2018-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Status](https://img.shields.io/badge/Ready%20to%20Install-Yes-brightgreen)](#-instant-installation-ready-to-install)

**Pruwear** turns your browser into an interactive virtual fitting mirror. Browse any fashion or e-commerce website (Zara, Myntra, ASOS, H&M, Amazon, Shopify, or local brand stores), click on or drag any clothing image directly onto your live mirror, and watch high-speed AI seamlessly scan and dress you in real time.

---

## ⚡ Instant Installation (Ready to Install)

The repository comes pre-bundled with the built, production-ready Chrome Extension. No build steps or Node.js required to install and use!

### Option A: 1-Click Auto Activator (Windows)
1. Clone or download this repository as a `.zip`.
2. Double-click **`activate-pruwear.bat`**.
3. Chrome will automatically launch with Pruwear loaded and open the onboarding portal!

---

### Option B: Manual Chrome Installation (Windows, Mac, Linux)
1. Open Google Chrome (or any Chromium browser like Brave, Edge, Opera).
2. Navigate to `chrome://extensions` in your address bar.
3. Turn on **Developer mode** using the toggle switch in the upper-right corner.
4. Click the **Load unpacked** button in the top left.
5. Select the **`pruwear-extension`** folder inside this repository.
6. 🎉 **Pruwear ✦ Virtual Try-On** is installed and ready!

---

## 🛍️ How to Use

1. **Open Any Store**: Visit any clothing or fashion website (Zara, Myntra, ASOS, H&M, Amazon, etc.).
2. **Open Fitting Room**: Click the glowing **✦ Try-On (Pruwear)** launcher floating on the right edge of your browser window.
3. **Allow Camera Access**: Turn on your webcam inside the popup mirror to initiate realtime pose estimation and fitting.
4. **Try On Clothes**:
   - Drag and drop any product or garment image from the store page right onto your live mirror.
   - Or upload your own garment photo using the upload box.
5. **View Results**: Watch the neural engine project the selected outfit onto your body live!

---

## ⚙️ Backend & API Configuration

Pruwear supports dual engine backends:

### 1. Built-in Cloud AI Engine (Lucy VTON 3.5)
- Right-click the Pruwear icon in your extension bar → click **Options** (or open extension settings).
- Under the **Decart Cloud** tab, enter your API token (`dct_...`).
- Click **Save**.

### 2. Custom Virtual Try-On API (FastAPI / PyTorch / Local / Remote)
- Open extension **Options** → click the **✦ Custom API** tab.
- Enter your endpoint URL (e.g. `http://localhost:8000/api/tryon`), authentication method, and payload format (`rest-json` or `rest-form`).
- Or simply import the provided `pruwear-api-config.example.json` file!
- Click **⚡ Test Connection** and **Save & Activate Custom API**.

---

## 🛠️ Building from Source (For Developers)

If you wish to modify the extension or build it yourself:

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### Steps
```bash
# 1. Install dependencies
npm install

# 2. Build for production (Plasmo Chrome MV3)
npm run build
```

The compiled extension will be output to:
- `build/chrome-mv3-prod/`

---

## 📂 Repository Structure

```
├── pruwear-extension/              # Pre-built unpacked Chrome Extension (Ready to install!)
│   ├── manifest.json               # Manifest V3 specification
│   ├── popup.html / popup.js       # Extension quick action menu
│   ├── options.html / options.js   # Extension settings & custom API portal
│   ├── tabs/room.html              # Isolated try-on virtual mirror
│   └── vision/                     # MediaPipe pose landmarker & WASM models
├── assets/                         # Extension icons and graphics
├── lib/                            # Core client libraries and API clients
├── scripts/                        # Build, prebundle, and release automation
├── tabs/                           # React components for virtual mirror
├── background.ts                   # Chrome MV3 background service worker
├── content.tsx                     # Injected floating drawer & drag-and-drop trigger
├── options.tsx                     # Settings page UI (React + Glassmorphism)
├── popup.tsx                       # Popup menu UI
├── activate-pruwear.bat            # 1-Click launcher script for Windows
├── START_HERE.html                 # Interactive activation walkthrough guide
├── index.html                      # Executive activation portal
└── package.json                    # Project metadata & npm dependencies
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

# Pruwear ✦ Realtime Virtual Try-On Extension (Firefox & Chrome)

> **Realtime AI Virtual Try-On Browser Extension powered by Lucy VTON 3.5 & MediaPipe**

[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on%20MV3-FF7139?logo=firefox&logoColor=white)](https://addons.mozilla.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Plasmo](https://img.shields.io/badge/Built%20with-Plasmo-blue)](https://docs.plasmo.com/)
[![React](https://img.shields.io/badge/UI-React%2018-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Status](https://img.shields.io/badge/Ready%20to%20Install-Yes-brightgreen)](#-installation--ready-to-install)

**Pruwear** transforms your browser into an intelligent virtual fitting mirror. Browse any fashion or e-commerce website (Zara, Myntra, ASOS, H&M, Amazon, Shopify, or local brand stores), click on or drag any clothing image directly onto your live mirror, and watch high-speed AI seamlessly scan and dress you in real time.

---

## ⚡ Installation (Ready to Install)

The repository comes pre-bundled with built, production-ready extensions for **both Firefox and Chrome**. No build steps or Node.js required!

### 🦊 For Mozilla Firefox

#### Option 1: 1-Click Quick Loader (Windows)
1. Double-click **`activate-pruwear-firefox.bat`**.
2. Firefox will open straight to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select `manifest.json` inside the **`pruwear-firefox-extension`** folder (or choose `pruwear-firefox.xpi` / `Pruwear-Firefox-Virtual-Try-On.zip`).

#### Option 2: Manual Firefox Installation (Windows, Mac, Linux)
1. Open Firefox and navigate to:
   ```
   about:debugging#/runtime/this-firefox
   ```
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` inside the **`pruwear-firefox-extension`** folder.
4. 🎉 **Pruwear** is now active in Firefox!

---

### 🌐 For Google Chrome & Chromium Browsers

#### Option 1: 1-Click Auto Activator (Windows)
1. Double-click **`activate-pruwear.bat`**.
2. Chrome will automatically launch with Pruwear loaded and open the onboarding portal!

#### Option 2: Manual Chrome Installation (Windows, Mac, Linux)
1. In Chrome, navigate to `chrome://extensions`.
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked**.
4. Select the **`pruwear-extension`** folder.
5. 🎉 **Pruwear** is active and ready!

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
- Open extension **Options** (right-click extension icon → Options).
- Under the **Decart Cloud** tab, enter your API token (`dct_...`).
- Click **Save**.

### 2. Custom Virtual Try-On API (FastAPI / PyTorch / Local / Remote)
- Open extension **Options** → click the **✦ Custom API** tab.
- Enter your endpoint URL (e.g. `http://localhost:8000/api/tryon`), authentication method, and payload format (`rest-json` or `rest-form`).
- Or simply import the provided `pruwear-api-config.example.json` file!
- Click **⚡ Test Connection** and **Save & Activate Custom API**.

---

## 🛠️ Building from Source (For Developers)

```bash
# 1. Install dependencies
npm install

# 2. Build for Firefox
npm run build:firefox

# 3. Build for Chrome
npm run build

# 4. Package Firefox distribution (.zip and .xpi)
npm run package:firefox
```

---

## 📂 Repository Structure

```
├── pruwear-firefox-extension/      # Pre-built unpacked Firefox Extension (Ready to install!)
│   ├── manifest.json               # Firefox MV3 manifest with gecko settings
│   ├── static/background/          # Firefox background scripts
│   ├── tabs/room.html              # Isolated try-on virtual mirror
│   └── vision/                     # MediaPipe pose landmarker & WASM models
├── pruwear-extension/              # Pre-built unpacked Chrome Extension (Ready to install!)
│   ├── manifest.json               # Chrome MV3 manifest
│   └── ...
├── activate-pruwear-firefox.bat    # 1-Click launcher for Firefox
├── activate-pruwear.bat            # 1-Click launcher for Chrome
├── START_HERE.html                 # Interactive activation walkthrough guide
├── index.html                      # Executive activation portal
└── package.json                    # Project metadata & npm dependencies
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

# Pruwear — How It Works & Architecture Guide

> **An Architectural Overview of Real-Time In-Browser AI Virtual Try-On**

---

## 1. Executive Summary

**Pruwear** is an intelligent browser extension that turns any web browser into an interactive, real-time virtual fitting mirror. While shopping on any fashion e-commerce storefront (such as Zara, Myntra, ASOS, H&M, Amazon, or boutique platforms), shoppers can drag and drop clothing images or click contextual buttons to instantly see how garments fit and drape on their own body in real time.

The system combines **client-side computer vision**, an **isolated cross-origin extension architecture**, **intelligent e-commerce asset extraction**, and **low-latency neural virtual try-on pipelines**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           E-COMMERCE STOREPAGE                          │
│  (Zara, Myntra, ASOS, Amazon, Shopify, etc.)                            │
│                                                                         │
│   ┌─────────────────────┐            ┌──────────────────────────────┐   │
│   │  Garment Product    │  Drag &    │  Floating Shadow-DOM Dock    │   │
│   │  High-Res Imagery   │ ─────────> │  & Contextual Trigger        │   │
│   └─────────────────────┘   Drop     └──────────────┬───────────────┘   │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │ postMessage
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               ISOLATED VIRTUAL FITTING ROOM (Extension Sandbox)         │
│                                                                         │
│   ┌───────────────────────────┐       ┌─────────────────────────────┐   │
│   │   Webcam Feed (User)      │       │ Client-Side Pose Estimation │   │
│   │   60fps Live Video        │ ────> │ Local WebAssembly Vision    │   │
│   └─────────────┬─────────────┘       └──────────────┬──────────────┘   │
│                 │                                    │                  │
│                 │   Framing Guide & Silhouette Mask  │                  │
│                 ▼                                    ▼                  │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │             Neural Virtual Try-On Synthesis Pipeline            │   │
│   │   - Garment Warping & Fabric Drapery Modeling                   │   │
│   │   - Lighting, Texture, & Contour Alignment                     │   │
│   │   - Low-Latency Real-Time Video Streaming (WebRTC)              │   │
│   └─────────────────────────────────┬───────────────────────────────┘   │
│                                     │                                   │
│                                     ▼                                   │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │             Live Virtual Fitting Mirror Output Screen           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Operational Workflow

The end-to-end user experience operates in five distinct, synchronized phases:

### Phase 1: Seamless In-Page Discovery & Trigger Injection
- **Non-Invasive Page Injection**: When a user navigates to any online store, a lightweight background content script quietly inspects the page environment.
- **Shadow DOM Encapsulation**: The user interface (the floating launcher dock and contextual try-on badges) is rendered inside an isolated **Shadow DOM** boundary. This prevents the host website's CSS rules from breaking the extension's styling, and prevents extension styles from polluting the online store.
- **SPA & Dynamic Hydration Compatibility**: The extension monitors document lifecycle changes and DOM mutations, ensuring that modern single-page applications (React, Vue, Next.js) do not unmount or conflict with the fitting launcher during navigation.

### Phase 2: High-Resolution Garment Asset Extraction
E-commerce websites heavily optimize bandwidth by displaying downsampled thumbnails, compressed WebP files, or responsive image slices (`srcset`). When a garment image or product link is dropped onto Pruwear:
- **Resolution Escalation Engine**: The extension inspects image attributes (`data-zoom-image`, `data-old-hires`, `data-src-zoom`, and responsive `srcset` arrays) to bypass downsampled thumbnails and retrieve the pristine, uncompressed master catalog photo.
- **Link Resolution & OpenGraph Parser**: If a shopper drags a product URL or card rather than an image element, the background worker analyzes the target page's structured metadata (`og:image`, `twitter:image`, high-resolution product link tags) to automatically identify and extract the primary garment.
- **Format Normalization**: The retrieved garment is converted into an optimal, high-fidelity format and cached in local memory, ready for neural synthesis.

### Phase 3: Client-Side Pose Tracking & Alignment Guidance
- **Zero-Latency In-Browser Vision**: Once the user enables their webcam, a specialized vision processing pipeline running directly inside the browser via WebAssembly (WASM) activates immediately.
- **No Cloud Latency for Tracking**: Body pose analysis, limb tracking, and joint coordinates are computed 100% locally on the user's machine without transmitting raw video frames to external servers for tracking.
- **Interactive Body-Framing Guide**: The vision engine computes real-time anatomical proportions (shoulders, torso, waist, stance). If the user is standing too close, too far, or misaligned, dynamic on-screen guides help them position themselves for an accurate fitting result.
- **Silhouetting & Background Separation**: Real-time segmentation masks identify user contours to maintain clear boundaries between the user, their clothes, and the physical room background.

### Phase 4: Neural Virtual Try-On Synthesis
Once the user is framed and a garment is selected:
- **Holographic Transition**: A visual scanning effect provides immediate feedback while the neural pipeline establishes the stream.
- **Fabric Warping & Structural Drapery**: The neural synthesis pipeline maps the 2D garment imagery onto the 3D anatomical volume of the user. It realistically simulates fabric weight, stretch, perspective, and natural folds based on the user's posture.
- **Color & Lighting Harmonization**: The synthesis pipeline automatically balances color temperature, ambient room lighting, shadows, and reflections so the garment appears naturally integrated rather than pasted over the video.
- **Continuous Real-Time Movement**: The neural engine continuously processes incoming live video frames, enabling the shopper to turn, step back, and move naturally while previewing the outfit.

### Phase 5: Result Persistence & Comparison
- Shoppers can test multiple garments in rapid succession by simply dragging new items from the store catalog.
- The fitting room maintains a history of tried items, allowing users to compare different styles, colors, and cuts side-by-side before making purchase decisions.

---

## 3. System Architecture & Security Design

### 1. Isolated Sandbox Architecture
To ensure maximum user privacy and protect both the shopper and host e-commerce stores:
- **Origin Isolation**: The camera feed and virtual fitting mirror execute inside an isolated extension page (`tabs/room.html`) embedded within an iframe.
- **Camera Sandbox**: The host shopping site never gains access to the user's webcam or microphone. Camera permissions are strictly scoped to the extension's secure origin.
- **Content Security Policy (CSP) Immunity**: Because the fitting room operates in its own sandboxed context, strict CSP rules on banking or major retail portals cannot block the WebRTC video stream or WebAssembly vision tasks.

### 2. Dual-Engine Processing Flexibility
Pruwear is architected with a modular backend adapter system:
- **Standard Cloud Engine**: A turn-key, high-speed neural video streaming pipeline optimized for real-time WebRTC latency, requiring zero local GPU configuration.
- **Private / Custom API Engine**: For privacy-focused enterprise deployments, local GPU setups, or custom machine learning models (FastAPI, PyTorch, ComfyUI, etc.), Pruwear can be pointed to any private REST endpoint supporting JSON or Multipart-form payloads.

---

## 4. Key Performance Highlights

- **Near-Instant Framing Feedback**: Client-side WASM vision executes in milliseconds per frame on CPU.
- **Bandwidth Optimization**: Camera streams adapt dynamically to client connection speeds, maintaining smooth framerates even on standard home Wi-Fi.
- **Zero Host Impact**: Memory and execution overhead on the shopping website are negligible, ensuring smooth store browsing without lag or stutter.

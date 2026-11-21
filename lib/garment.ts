// Garment naming, the Decart prompt, reference-image preparation and Lookbook presets.

/** Strips prices, store boilerplate and separators from a product title. */
export function cleanName(raw: string) {
  const text = raw
    .replace(/\s+/g, " ")
    .replace(/(RM|USD|\$|€|£|¥|INR|₹)\s?\d[\d.,]*/gi, "")
    .replace(/\b(buy|shop|sale|new|online|official|store|amazon|myntra|zara)\b.*$/i, "")
    .replace(/[|•·–—].*$/, "")
    .trim()
  return text.length > 70 ? `${text.slice(0, 70).trim()}…` : text
}

/** Every try-on swaps the complete outfit shown in the photo. */
export function buildPrompt(name: string) {
  const named = name && name.length <= 48 ? `, including the ${name.toLowerCase()}` : ""
  return `Substitute the outfit with the complete haute-couture outfit shown in the reference image${named}. Ultra-high quality photorealistic fabric drape and fit.`
}

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"])

/** Letterboxes any garment image onto a clean white 768px square JPEG. */
export async function normalizeImage(source: Blob | string): Promise<{ blob: Blob; preview: string }> {
  if (typeof source !== "string" && (!ACCEPTED.has(source.type) || source.size > 8 * 1024 * 1024)) {
    throw Error("Use a JPG, PNG or WebP image under 8 MB")
  }
  const objectUrl = typeof source === "string" ? source : URL.createObjectURL(source)
  try {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.src = objectUrl
    await image.decode()
    const size = 768
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const context = canvas.getContext("2d")!
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size, size)
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight) * 0.94
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale
    context.imageSmoothingQuality = "high"
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => (value ? resolve(value) : reject(Error("Could not prepare image"))), "image/jpeg", 0.92)
    )
    return { blob, preview: canvas.toDataURL("image/jpeg", 0.8) }
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(objectUrl)
  }
}

/** Creates a high-res styled vector garment data URL for instant 1-click lookbook trials */
function createPresetGarmentDataUrl(title: string, color1: string, color2: string, style: "jacket" | "hoodie" | "trench" | "blazer"): string {
  const canvas = document.createElement("canvas")
  canvas.width = 768
  canvas.height = 768
  const ctx = canvas.getContext("2d")!
  
  // Clean neutral background
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 768, 768)

  // Gradient fill for luxury fabric
  const grad = ctx.createLinearGradient(180, 100, 580, 680)
  grad.addColorStop(0, color1)
  grad.addColorStop(1, color2)

  ctx.fillStyle = grad
  ctx.strokeStyle = "#111827"
  ctx.lineWidth = 6

  ctx.beginPath()
  if (style === "trench") {
    // Trench coat silhouette
    ctx.moveTo(384, 120)
    ctx.lineTo(470, 150)
    ctx.lineTo(600, 300)
    ctx.lineTo(520, 360)
    ctx.lineTo(480, 260)
    ctx.lineTo(510, 680)
    ctx.lineTo(258, 680)
    ctx.lineTo(288, 260)
    ctx.lineTo(248, 360)
    ctx.lineTo(168, 300)
    ctx.lineTo(298, 150)
  } else if (style === "hoodie") {
    // Oversized hoodie silhouette
    ctx.moveTo(384, 90)
    ctx.bezierCurveTo(460, 90, 480, 140, 490, 170)
    ctx.lineTo(620, 330)
    ctx.lineTo(540, 380)
    ctx.lineTo(490, 280)
    ctx.lineTo(490, 620)
    ctx.lineTo(278, 620)
    ctx.lineTo(278, 280)
    ctx.lineTo(228, 380)
    ctx.lineTo(148, 330)
    ctx.bezierCurveTo(280, 140, 308, 90, 384, 90)
  } else {
    // Structured jacket / blazer
    ctx.moveTo(384, 130)
    ctx.lineTo(480, 150)
    ctx.lineTo(590, 310)
    ctx.lineTo(520, 360)
    ctx.lineTo(475, 260)
    ctx.lineTo(485, 590)
    ctx.lineTo(283, 590)
    ctx.lineTo(293, 260)
    ctx.lineTo(248, 360)
    ctx.lineTo(178, 310)
    ctx.lineTo(288, 150)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // High-tech typography label on garment
  ctx.fillStyle = "#ffffff"
  ctx.font = "bold 28px sans-serif"
  ctx.textAlign = "center"
  ctx.fillText(`PRUWEAR · ${title.toUpperCase()}`, 384, 420)

  return canvas.toDataURL("image/jpeg", 0.9)
}

export type LookbookItem = {
  id: string
  name: string
  category: string
  color: string
  style: "jacket" | "hoodie" | "trench" | "blazer"
  getDataUrl: () => string
}

export const LOOKBOOK_ITEMS: LookbookItem[] = [
  {
    id: "cyber-bomber",
    name: "Cyberpunk Iridescent Bomber",
    category: "TECHWEAR",
    color: "#00f0ff",
    style: "jacket",
    getDataUrl: () => createPresetGarmentDataUrl("Cyber Bomber", "#0f172a", "#00f0ff", "jacket")
  },
  {
    id: "silk-trench",
    name: "Midnight Luxury Silk Trench",
    category: "RUNWAY",
    color: "#a855f7",
    style: "trench",
    getDataUrl: () => createPresetGarmentDataUrl("Silk Trench", "#1e1b4b", "#7c3aed", "trench")
  },
  {
    id: "neon-hoodie",
    name: "Tokyo Hyper-Neon Hoodie",
    category: "STREETWEAR",
    color: "#ec4899",
    style: "hoodie",
    getDataUrl: () => createPresetGarmentDataUrl("Neon Hoodie", "#831843", "#ec4899", "hoodie")
  },
  {
    id: "obsidian-blazer",
    name: "Minimalist Structured Blazer",
    category: "HAUTE COUTURE",
    color: "#38bdf8",
    style: "blazer",
    getDataUrl: () => createPresetGarmentDataUrl("Obsidian Blazer", "#020617", "#334155", "blazer")
  }
]

/** Reading pasted, dropped or uploaded images into compact data URLs. */

const MAX_SIDE = 1600

export interface LoadedImage {
  src: string
  w: number
  h: number
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That image could not be read'))
    img.src = src
  })
}

/**
 * Loads an image file, shrinking big ones (longest side 1600px) so boards stay
 * small enough to save in the browser. SVGs are kept as they are.
 */
export async function readImage(file: Blob): Promise<LoadedImage> {
  const original = await readAsDataUrl(file)
  const img = await loadImage(original)
  const w = img.naturalWidth || 400
  const h = img.naturalHeight || 300
  if (file.type === 'image/svg+xml' || (Math.max(w, h) <= MAX_SIDE && file.size < 400_000)) return { src: original, w, h }
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  let src = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86)
  if (src.length > 1_500_000) src = canvas.toDataURL('image/jpeg', 0.82)
  return { src, w, h }
}

export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const out: File[] = []
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null
    if (file && file.type.startsWith('image/')) out.push(file)
  }
  return out
}

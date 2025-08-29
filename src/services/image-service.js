/**
 * ImageService: load + normalize orientation
 *
 * Responsibilities:
 * - Load images from File or URL (PNG/JPEG/WebP)
 * - Parse EXIF orientation (JPEG) and render an upright ImageBitmap
 * - Maintain original (upright) and a working clone buffers
 * - Provide getters and resetWorking()
 * - Surface friendly errors
 */

const SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

/**
 * @typedef {Object} ImageMetadata
 * @property {string} sourceType - 'file' | 'url'
 * @property {string} [name] - file name if source is file
 * @property {string} mime - mime type
 * @property {number} width - displayed/oriented width
 * @property {number} height - displayed/oriented height
 * @property {number} orientation - EXIF orientation (1..8), 1 for non-JPEG
 * @property {number} byteLength - size of the blob in bytes
 */

class ImageServiceImpl {
  constructor() {
    /** @type {ImageBitmap|null} */
    this._original = null
    /** @type {ImageBitmap|null} */
    this._working = null
    /** @type {ImageMetadata|null} */
    this._meta = null
  }

  /**
   * Load from a File
   * @param {File} file
   */
  async loadFromFile(file) {
    if (!(file instanceof Blob)) {
      throw this._friendlyError('Provided input is not a File/Blob.')
    }
    return await this._loadFromBlob(file, {
      sourceType: 'file',
      name: file.name || undefined,
    })
  }

  /**
   * Load from URL (same-origin or CORS-enabled)
   * @param {string} url
   */
  async loadFromUrl(url) {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      return await this._loadFromBlob(blob, { sourceType: 'url' })
    } catch (err) {
      throw this._friendlyError(
        `Failed to load image from URL. ${this._asMessage(err)} ` +
          'Ensure the URL is correct and CORS is enabled.'
      )
    }
  }

  /**
   * @returns {ImageBitmap|null}
   */
  getOriginal() {
    return this._original
  }

  /**
   * @returns {ImageBitmap|null}
   */
  getWorking() {
    return this._working
  }

  /**
   * @returns {ImageMetadata|null}
   */
  getMetadata() {
    return this._meta
  }

  /**
   * Reset working buffer to a fresh clone of original
   */
  async resetWorking() {
    if (!this._original) return
    this._working = await this._cloneBitmap(this._original)
  }

  // Internal -----------------------------------------------------------------

  async _loadFromBlob(blob, baseMeta) {
    if (!SUPPORTED_TYPES.has(blob.type)) {
      throw this._friendlyError(
        'Unsupported image format. Please use PNG, JPEG, or WebP.'
      )
    }

    // Read bytes to inspect EXIF orientation for JPEG
    let orientation = 1
    let byteLength = blob.size
    try {
      if (blob.type === 'image/jpeg' || (await this._isJpeg(blob))) {
        const buf = await blob.arrayBuffer()
        orientation = this._readExifOrientation(new DataView(buf)) || 1
      }
    } catch (e) {
      // Non-fatal: if EXIF parsing fails, continue with orientation 1
      orientation = 1
    }

    // Decode to ImageBitmap
    let decoded = null
    try {
      decoded = await this._decodeToBitmap(blob)
    } catch (err) {
      throw this._friendlyError(
        `Could not decode image. ${this._asMessage(err)} ` +
          'The file may be corrupted or unsupported.'
      )
    }

    // Normalize orientation: draw to canvas with transforms and create upright bitmap
    const upright = await this._normalizeOrientation(decoded, orientation)

    // Prepare original and working buffers
    this._original = upright
    this._working = await this._cloneBitmap(upright)

    const width = upright.width
    const height = upright.height

    this._meta = {
      ...baseMeta,
      mime: blob.type || 'application/octet-stream',
      width,
      height,
      orientation,
      byteLength,
    }

    return {
      original: this._original,
      working: this._working,
      metadata: this._meta,
    }
  }

  async _decodeToBitmap(blob) {
    if ('createImageBitmap' in window) {
      try {
        // Do not rely on imageOrientation: 'from-image' because we normalize manually
        return await createImageBitmap(blob)
      } catch (_) {
        // Fallback below
      }
    }
    // Fallback: HTMLImageElement
    const url = URL.createObjectURL(blob)
    try {
      const img = await this._loadHtmlImage(url)
      const bmp = await this._imageToBitmap(img)
      return bmp
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  _loadHtmlImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image load error'))
      img.decoding = 'async'
      img.src = src
    })
  }

  async _imageToBitmap(img) {
    if ('createImageBitmap' in window) {
      return await createImageBitmap(img)
    }
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return await this._canvasToBitmap(canvas)
  }

  async _canvasToBitmap(canvas) {
    if ('transferToImageBitmap' in canvas) {
      return canvas.transferToImageBitmap()
    }
    // Fallback via blob
    const blob = await new Promise((resolve) => canvas.toBlob(resolve))
    if (!blob) throw new Error('Canvas toBlob failed')
    return await this._decodeToBitmap(blob)
  }

  async _cloneBitmap(bitmap) {
    // Draw the bitmap onto a canvas then create a new ImageBitmap
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    return await this._canvasToBitmap(canvas)
  }

  async _normalizeOrientation(bitmap, orientation) {
    if (orientation === 1) return bitmap // already upright

    const sw = bitmap.width
    const sh = bitmap.height

    // Determine canvas size after rotation/mirroring
    const isRotated = orientation >= 5 && orientation <= 8
    const dw = isRotated ? sh : sw
    const dh = isRotated ? sw : sh

    const canvas = document.createElement('canvas')
    canvas.width = dw
    canvas.height = dh
    const ctx = canvas.getContext('2d')

    // Apply transforms per EXIF orientation mapping
    // Reference: https://magnushoff.com/articles/jpeg-orientation/
    switch (orientation) {
      case 2: // Mirror horizontally
        ctx.translate(dw, 0)
        ctx.scale(-1, 1)
        break
      case 3: // Rotate 180
        ctx.translate(dw, dh)
        ctx.rotate(Math.PI)
        break
      case 4: // Mirror vertically
        ctx.translate(0, dh)
        ctx.scale(1, -1)
        break
      case 5: // Mirror horizontally and rotate 90 CW
        ctx.rotate(0.5 * Math.PI)
        ctx.scale(1, -1)
        ctx.translate(0, -sh)
        break
      case 6: // Rotate 90 CW
        ctx.rotate(0.5 * Math.PI)
        ctx.translate(0, -sh)
        break
      case 7: // Mirror horizontally and rotate 90 CCW
        ctx.rotate(-0.5 * Math.PI)
        ctx.scale(1, -1)
        ctx.translate(-sw, 0)
        break
      case 8: // Rotate 90 CCW
        ctx.rotate(-0.5 * Math.PI)
        ctx.translate(-sw, 0)
        break
      default:
        // Unknown, draw as is
        break
    }

    // Draw source into context with possible transformed axes
    ctx.drawImage(bitmap, 0, 0)

    return await this._canvasToBitmap(canvas)
  }

  async _isJpeg(blob) {
    // Quick check: first two bytes 0xFFD8
    const slice = blob.slice(0, 2)
    const buf = await slice.arrayBuffer()
    const view = new DataView(buf)
    return view.getUint16(0) === 0xffd8
  }

  /**
   * Parse EXIF orientation (1..8) from JPEG bytes.
   * Returns null if not found.
   * Inspired by exif-parser logic; minimal implementation to avoid deps.
   * @param {DataView} view
   * @returns {number|null}
   */
  _readExifOrientation(view) {
    // JPEG structure: SOI (FFD8) ... APP1 (FFE1) with 'Exif\0\0' then TIFF header
    if (view.getUint16(0) !== 0xffd8) return null
    let offset = 2
    const length = view.byteLength
    while (offset + 4 <= length) {
      const marker = view.getUint16(offset)
      offset += 2
      if (marker === 0xffda /* SOS */ || marker === 0xffd9 /* EOI */) break
      if ((marker & 0xff00) !== 0xff00) break // invalid
      const size = view.getUint16(offset)
      if (size < 2) break
      const segmentStart = offset + 2
      if (marker === 0xffe1 /* APP1 */) {
        // Check for Exif header
        if (segmentStart + 6 <= length) {
          const exifStr =
            String.fromCharCode(
              view.getUint8(segmentStart + 0),
              view.getUint8(segmentStart + 1),
              view.getUint8(segmentStart + 2),
              view.getUint8(segmentStart + 3)
            ) +
            String.fromCharCode(
              view.getUint8(segmentStart + 4),
              view.getUint8(segmentStart + 5)
            )
          if (exifStr === 'Exif\u0000\u0000' || exifStr === 'Exif\x00\x00') {
            const tiff = segmentStart + 6
            const orient = this._readTiffOrientation(view, tiff)
            if (orient) return orient
          }
        }
      }
      offset += size
    }
    return null
  }

  _readTiffOrientation(view, tiffOffset) {
    const length = view.byteLength
    if (tiffOffset + 8 > length) return null

    // Endianness
    const endian = String.fromCharCode(
      view.getUint8(tiffOffset),
      view.getUint8(tiffOffset + 1)
    )
    const little = endian === 'II'
    if (!little && endian !== 'MM') return null

    const magic = view.getUint16(tiffOffset + 2, little)
    if (magic !== 0x2a) return null

    const ifdOffset = view.getUint32(tiffOffset + 4, little)
    let dirOffset = tiffOffset + ifdOffset
    if (dirOffset + 2 > length) return null

    const entries = view.getUint16(dirOffset, little)
    dirOffset += 2

    for (let i = 0; i < entries; i++) {
      const entryOffset = dirOffset + i * 12
      if (entryOffset + 12 > length) break
      const tag = view.getUint16(entryOffset, little)
      if (tag === 0x0112) {
        // Orientation
        const type = view.getUint16(entryOffset + 2, little)
        const count = view.getUint32(entryOffset + 4, little)
        if (type !== 3 || count !== 1) return null // expect SHORT,1
        const valueOffset = entryOffset + 8
        const value = view.getUint16(valueOffset, little)
        if (value >= 1 && value <= 8) return value
        return null
      }
    }

    return null
  }

  _friendlyError(message) {
    const err = new Error(message)
    err.isFriendly = true
    return err
  }

  _asMessage(err) {
    return (err && (err.message || String(err))) || 'Unknown error'
  }
}

export const ImageService = new ImageServiceImpl()

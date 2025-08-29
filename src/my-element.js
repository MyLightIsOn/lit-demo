import { LitElement, css, html } from 'lit'
import { ImageService } from './services/image-service.js'
import { ViewportService } from './services/viewport-service.js'
import { Telemetry } from './services/telemetry-service.js'

// Embedded bundled sample image as data URL (1x1 transparent PNG)
// This keeps the sample within the bundle without needing an external file.
const SAMPLE_IMAGE_URL =
  '/samples/apple.png'

/**
 * Canvas editor shell (placeholder) with sample picker wiring.
 *
 * @slot - This element has a slot
 * @csspart button - The button
 */
export class MyElement extends LitElement {
  static get properties() {
    return {
      // Internal state flags
      _loading: { state: true },
      _error: { state: true },
      // Track if an image is loaded
      _hasImage: { state: true },
    }
  }

  constructor() {
    super()
    this.docsHint = 'Choose an Image'
    this._loading = false
    this._error = ''
    this._hasImage = false
    /** @type {ImageBitmap|null} */
    this._bitmap = null
    /** @type {{percent:number,workingWidth:number,workingHeight:number}|null} */
    this._downscaleInfo = null
    // Track whether viewport was initialized for current image
    this._vpInit = false

    // Rendering loop state
    this._dirtyImage = false
    this._dirtyViewport = false
    this._dirtyOverlay = false
    this._raf = 0

    // Debug overlay toggle
    this._showDebugOverlay = false

    // Track first paint mark
    this._didMarkFirstPaint = false

    // Input / interaction state
    this._spaceDown = false
    this._handActive = false // temporary hand while space held (no full tool system yet)
    this._panning = false
    this._pointerId = null
    this._lastX = 0
    this._lastY = 0

    // Toasts state
    /** @type {{id:number,message:string}[]} */
    this._toasts = []
    this._nextToastId = 1
  }

  render() {
    return html`


      <div class="toolbar">
        <button @click=${this._onChooseSample} part="button" ?disabled=${this._loading}>
          ${this._loading ? 'Loading…' : 'Choose sample'}
        </button>
        <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" @change=${this._onFileChosen} hidden />
        <button @click=${this._onUploadClick} part="button" ?disabled=${this._loading}>
          ${this._loading ? 'Loading…' : 'Upload image'}
        </button>
      </div>

      <div class="content">
        <div class="canvas-stack" id="canvasStack">
          <canvas id="baseCanvas" class="layer base" width="1" height="1"></canvas>
          <canvas id="overlayCanvas" class="layer overlay" width="1" height="1"></canvas>
        </div>
      </div>

      <div class="toasts" aria-live="polite" aria-atomic="true">
        ${this._toasts.map(t => html`<div class="toast" role="status">${t.message}</div>`)}
      </div>
    `
  }

  _showToast(message, timeoutMs = 4500) {
    const id = this._nextToastId++
    this._toasts = [...this._toasts, { id, message }]
    // Auto-dismiss after timeout
    setTimeout(() => {
      this._toasts = this._toasts.filter(t => t.id !== id)
      this.requestUpdate()
    }, timeoutMs)
  }

  firstUpdated() {
    // Setup resize handling for DPR and container changes
    this._installResizeHandling()
    // Setup input handling (spacebar hand + pan)
    this._installInputHandling()
    // Initial invalidate to kick the RAF loop
    this._invalidate({ image: true, viewport: true, overlay: true })
    // Mark first meaningful paint when we draw the first frame
    this._didMarkFirstPaint = false
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this._teardownResizeHandling()
    this._teardownInputHandling()
    if (this._raf) {
      cancelAnimationFrame(this._raf)
      this._raf = 0
    }
  }

  updated(changed) {
    if (changed.has('_hasImage') || changed.has('_bitmap')) {
      // Reset viewport init when bitmap changes
      if (changed.has('_bitmap')) this._vpInit = false
      this._invalidate({ image: true, viewport: true, overlay: true })
    }
    // Reinstall input handlers when canvas stack appears/disappears
    if (changed.has('_hasImage')) {
      this._teardownInputHandling()
      this._installInputHandling()
    }
  }

  async _onChooseSample() {
    this._error = ''
    this._loading = true
    const prevBitmap = this._bitmap
    const prevHasImage = this._hasImage
    try {
      // Load via ImageService from a bundled URL
      Telemetry.mark('imageLoadStart'); Telemetry.startTimer('imageLoad')
      const { working } = await ImageService.loadFromUrl(SAMPLE_IMAGE_URL)
      this._bitmap = working
      this._hasImage = !!working
      const meta = ImageService.getMetadata()
      this._downscaleInfo = meta && meta.isDownscaled ? {
        percent: Math.round((meta.downscaleFactor || 1) * 100),
        workingWidth: meta.workingWidth,
        workingHeight: meta.workingHeight,
      } : null
    } catch (err) {
      const msg = (err && (err.isFriendly ? err.message : err.message)) || 'Failed to load sample.'
      this._showToast(`${msg} Try again or choose another image.`)
      // Preserve last stable state
      this._bitmap = prevBitmap
      this._hasImage = prevHasImage
    } finally {
      try { Telemetry.endTimer('imageLoad') } catch {}
      this._loading = false
    }
  }

  _onUploadClick() {
    const input = /** @type {HTMLInputElement|null} */ (this.renderRoot?.getElementById('fileInput'))
    input?.click()
  }

  async _onFileChosen(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget)
    const file = input?.files && input.files[0]
    // Clear selection so choosing the same file again will trigger change
    if (input) input.value = ''
    if (!file) return

    this._error = ''
    this._loading = true
    const prevBitmap = this._bitmap
    const prevHasImage = this._hasImage
    try {
      Telemetry.mark('imageLoadStart'); Telemetry.startTimer('imageLoad')
      const { working } = await ImageService.loadFromFile(file)
      this._bitmap = working
      this._hasImage = !!working
      const meta = ImageService.getMetadata()
      this._downscaleInfo = meta && meta.isDownscaled ? {
        percent: Math.round((meta.downscaleFactor || 1) * 100),
        workingWidth: meta.workingWidth,
        workingHeight: meta.workingHeight,
      } : null
    } catch (err) {
      const msg = (err && (err.isFriendly ? err.message : err.message)) || 'Failed to load image.'
      this._showToast(`${msg} Try a PNG, JPEG, or WebP, or resize the image and try again.`)
      // Preserve last stable state
      this._bitmap = prevBitmap
      this._hasImage = prevHasImage
    } finally {
      try { Telemetry.endTimer('imageLoad') } catch {}
      this._loading = false
    }
  }

  _installResizeHandling() {
    // Invalidate on window resize and DPR changes (e.g., browser zoom)
    this._onResize = () => this._invalidate({ viewport: true, overlay: true })
    window.addEventListener('resize', this._onResize, { passive: true })

    // Observe container size changes precisely
    const stack = /** @type {HTMLElement|null} */ (this.renderRoot?.getElementById('canvasStack'))
    if (window.ResizeObserver && stack) {
      this._ro = new ResizeObserver(() => this._invalidate({ viewport: true, overlay: true }))
      this._ro.observe(stack)
    }

    // Listen to DPR change via media queries (some browsers)
    try {
      this._dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      if (this._dprMql && this._dprMql.addEventListener) {
        this._onDprChange = () => this._invalidate({ viewport: true, overlay: true })
        this._dprMql.addEventListener('change', this._onDprChange)
      }
    } catch {}
  }

  _teardownResizeHandling() {
    if (this._onResize) window.removeEventListener('resize', this._onResize)
    if (this._ro) {
      try { this._ro.disconnect() } catch {}
      this._ro = null
    }
    if (this._dprMql && this._onDprChange && this._dprMql.removeEventListener) {
      try { this._dprMql.removeEventListener('change', this._onDprChange) } catch {}
    }
    this._onResize = null
    this._onDprChange = null
    this._dprMql = null
  }

  // --- Input handling: spacebar-hand + mouse pan -----------------------------
  _installInputHandling() {
    // Keyboard: spacebar hand + zoom shortcuts
    this._onKeyDown = (e) => {
      if (this._isTextInput(e.target)) return

      // Zoom shortcuts
      const metaOrCtrl = !!(e.metaKey || e.ctrlKey)
      const stack = /** @type {HTMLElement|null} */ (this.renderRoot?.getElementById('canvasStack'))
      if (metaOrCtrl && stack) {
        const rect = stack.getBoundingClientRect()
        const sx = rect.width / 2
        const sy = rect.height / 2
        if (e.key === '+' || e.key === '=' || e.code === 'Equal') {
          ViewportService.zoomAt(1.1, sx, sy)
          this._invalidate({ viewport: true })
          e.preventDefault()
          return
        }
        if (e.key === '-' || e.key === '_' || e.code === 'Minus') {
          ViewportService.zoomAt(1 / 1.1, sx, sy)
          this._invalidate({ viewport: true })
          e.preventDefault()
          return
        }
      }
      // Fit to screen on '0'
      if (!e.metaKey && !e.ctrlKey && (e.key === '0' || e.code === 'Digit0')) {
        ViewportService.fitContain()
        this._invalidate({ viewport: true })
        e.preventDefault()
        return
      }

      // Temporary hand via Space
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        if (!this._spaceDown) {
          this._spaceDown = true
          this._handActive = true
          this._updateHandCursor()
        }
        e.preventDefault()
      }
    }
    this._onKeyUp = (e) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        this._spaceDown = false
        // If not actively panning, exit hand
        if (!this._panning) {
          this._handActive = false
          this._updateHandCursor()
        }
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)

    // Debug overlay toggle on backquote (`)
    this._onDebugToggle = (e) => {
      if (this._isTextInput(e.target)) return
      if (e.key === '`' || e.code === 'Backquote' || e.key === 'd' || e.key === 'D') {
        this._showDebugOverlay = !this._showDebugOverlay
        this._invalidate({ overlay: true })
      }
    }
    window.addEventListener('keydown', this._onDebugToggle)

    // Pointer: pan on drag while hand is active
    const base = /** @type {HTMLCanvasElement|null} */ (this.renderRoot?.getElementById('baseCanvas'))
    const stack = /** @type {HTMLElement|null} */ (this.renderRoot?.getElementById('canvasStack'))
    if (!base || !stack) return

    // Ensure we can set cursor on stack and suppress selection
    stack.style.userSelect = 'none'

    // Wheel zoom (cursor-anchored)
    this._onWheel = (e) => {
      if (!this._bitmap) return
      const rect = stack.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      // Normalize delta (pixels vs lines)
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const factor = Math.exp(-delta * 0.0015) // tune sensitivity
      ViewportService.zoomAt(factor, sx, sy)
      this._invalidate({ viewport: true })
      e.preventDefault()
    }
    stack.addEventListener('wheel', this._onWheel, { passive: false })

    this._onPointerDown = (e) => {
      if (!this._handActive) return
      if (e.button !== 0) return // left button only
      this._panning = true
      this._pointerId = e.pointerId
      base.setPointerCapture?.(e.pointerId)
      this._lastX = e.clientX
      this._lastY = e.clientY
      this._updateHandCursor(true) // grabbing
      e.preventDefault()
    }
    this._onPointerMove = (e) => {
      if (!this._panning || e.pointerId !== this._pointerId) return
      const dx = e.clientX - this._lastX
      const dy = e.clientY - this._lastY
      this._lastX = e.clientX
      this._lastY = e.clientY
      if (dx || dy) {
        ViewportService.panBy(dx, dy)
        this._invalidate({ viewport: true })
      }
      e.preventDefault()
    }
    this._onPointerUp = (e) => {
      if (e.pointerId !== this._pointerId) return
      this._panning = false
      this._pointerId = null
      base.releasePointerCapture?.(e.pointerId)
      // If space no longer held, exit hand
      if (!this._spaceDown) this._handActive = false
      this._updateHandCursor(false)
      e.preventDefault()
    }
    base.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
  }

  _teardownInputHandling() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('keydown', this._onDebugToggle)
    const base = /** @type {HTMLCanvasElement|null} */ (this.renderRoot?.getElementById('baseCanvas'))
    const stack = /** @type {HTMLElement|null} */ (this.renderRoot?.getElementById('canvasStack'))
    if (base) {
      base.removeEventListener('pointerdown', this._onPointerDown)
    }
    if (stack) {
      stack.removeEventListener('wheel', this._onWheel)
    }
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    this._onKeyDown = null
    this._onKeyUp = null
    this._onPointerDown = null
    this._onPointerMove = null
    this._onPointerUp = null
    this._onWheel = null
  }

  _isTextInput(target) {
    if (!target) return false
    const el = /** @type {HTMLElement} */ (target)
    const tag = (el.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea') return true
    if (el.isContentEditable) return true
    return false
  }

  _updateHandCursor(grabbing = false) {
    const stack = /** @type {HTMLElement|null} */ (this.renderRoot?.getElementById('canvasStack'))
    if (!stack) return
    // Toggle classes for cursor styling
    if (this._handActive) {
      stack.classList.add('hand')
      if (grabbing || this._panning) {
        stack.classList.add('grabbing')
      } else {
        stack.classList.remove('grabbing')
      }
    } else {
      stack.classList.remove('hand')
      stack.classList.remove('grabbing')
    }
  }

  _invalidate(flags = {}) {
    const { image = false, viewport = false, overlay = false } = flags
    if (image) this._dirtyImage = true
    if (viewport) this._dirtyViewport = true
    if (overlay) this._dirtyOverlay = true
    this._scheduleRender()
  }

  _scheduleRender() {
    if (this._raf) return
    this._raf = requestAnimationFrame(() => this._renderFrame())
  }

  _renderFrame() {
    this._raf = 0
    // Snapshot and clear dirty flags before draw
    const needImage = this._dirtyImage
    const needViewport = this._dirtyViewport
    const needOverlay = this._dirtyOverlay
    this._dirtyImage = false
    this._dirtyViewport = false
    this._dirtyOverlay = false

    // If nothing is dirty, do nothing (idle)
    if (!needImage && !needViewport && !needOverlay) return

    // Perform the actual draw
    this._draw()

    // Mark firstPaint once after first frame is drawn
    if (!this._didMarkFirstPaint) {
      this._didMarkFirstPaint = true
      try { Telemetry.markFirstPaint() } catch {}
    }

    // If new invalidations were requested during draw, schedule another frame
    if (this._dirtyImage || this._dirtyViewport || this._dirtyOverlay) {
      this._scheduleRender()
    }
  }

  _draw() {
    const base = /** @type {HTMLCanvasElement|null} */ (this.renderRoot?.getElementById('baseCanvas'))
    const overlay = /** @type {HTMLCanvasElement|null} */ (this.renderRoot?.getElementById('overlayCanvas'))
    const stack = /** @type {HTMLElement|null} */ (this.renderRoot?.getElementById('canvasStack'))
    if (!base || !overlay || !stack) return

    // Ensure canvases fill container
    base.style.width = '100%'
    base.style.height = '100%'
    overlay.style.width = '100%'
    overlay.style.height = '100%'

    // Compute CSS pixel viewport from the container
    const vw = stack.clientWidth | 0
    const vh = stack.clientHeight | 0
    if (vw <= 0 || vh <= 0) return

    // Device Pixel Ratio handling: scale backing store sizes
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const bw = Math.max(1, Math.round(vw * dpr))
    const bh = Math.max(1, Math.round(vh * dpr))
    if (base.width !== bw) base.width = bw
    if (base.height !== bh) base.height = bh
    if (overlay.width !== bw) overlay.width = bw
    if (overlay.height !== bh) overlay.height = bh

    const bctx = base.getContext('2d')
    const octx = overlay.getContext('2d')
    if (!bctx || !octx) return

    // Clear both layers at device-pixel resolution
    bctx.setTransform(1, 0, 0, 1, 0, 0)
    bctx.clearRect(0, 0, base.width, base.height)
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.clearRect(0, 0, overlay.width, overlay.height)

    if (!this._bitmap) {
      // Draw empty state overlay when no image is loaded
      this._drawEmptyOverlay(octx, vw, vh, dpr)
      return
    }

    // Initialize/update viewport for this image (in CSS pixels)
    ViewportService.setViewportSize(vw, vh)
    ViewportService.setContentSize(this._bitmap.width, this._bitmap.height)
    if (!this._vpInit) {
      ViewportService.fitContain()
      this._vpInit = true
    } else {
      ViewportService.clampPan()
    }

    // Apply combined DPR + viewport transform to base context
    const [a, , , d, e, f] = ViewportService.getTransform()
    bctx.setTransform(a * dpr, 0, 0, d * dpr, e * dpr, f * dpr)
    bctx.imageSmoothingEnabled = false
    bctx.drawImage(this._bitmap, 0, 0)

    // Reset transform for overlay; overlay will draw in CSS pixels scaled by DPR
    octx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Overlay hints when image is present (no selection system yet): show brush hint
    this._drawOnImageHint(octx, vw, vh)

    // If working image is downscaled, show a small badge to inform the user
    if (this._downscaleInfo) {
      this._drawDownscaleBadge(octx, vw, vh)
    }

    // Debug overlay (toggleable)
    if (this._showDebugOverlay) {
      this._drawDebugOverlay(octx, vw, vh, dpr, base)
    }
  }

  // Debug overlay: zoom, pan, DPR, canvas sizes
  _drawDebugOverlay(ctx, vw, vh, dpr, baseCanvas) {
    // Context for overlay is set to DPR scale by caller; reset to CSS px space
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const scale = ViewportService.scale
    const tx = ViewportService.tx
    const ty = ViewportService.ty
    const cssSize = `${vw}×${vh} CSS px`
    const pxSize = `${baseCanvas.width}×${baseCanvas.height} device px`

    const lines = [
      'Debug — press ` to toggle',
      `Zoom: ${scale.toFixed(3)} (min ${ViewportService.minScale.toFixed(3)}, max ${ViewportService.maxScale.toFixed(3)})`,
      `Pan: tx=${Math.round(tx)}, ty=${Math.round(ty)}`,
      `DPR: ${dpr}`,
      `Viewport: ${cssSize}`,
      `Canvas: ${pxSize}`,
    ]

    const base = Math.max(10, Math.min(14, Math.round(Math.min(vw, vh) * 0.025)))
    ctx.font = `500 ${base}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const padding = Math.round(base * 0.6)
    const lh = Math.round(base * 1.5)
    const width = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + padding * 2
    const height = lines.length * lh + padding * 2
    const x = vw - width - 8
    const y = 8

    // Panel background rounded rect
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    const r = Math.min(8, Math.round(height * 0.12))
    const right = x + width
    const bottom = y + height
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(right - r, y)
    ctx.quadraticCurveTo(right, y, right, y + r)
    ctx.lineTo(right, bottom - r)
    ctx.quadraticCurveTo(right, bottom, right - r, bottom)
    ctx.lineTo(x + r, bottom)
    ctx.quadraticCurveTo(x, bottom, x, bottom - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
    ctx.fill()

    // Text lines
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    lines.forEach((line, i) => {
      this._drawTextWithShadow(ctx, line, x + padding, y + padding + i * lh + Math.round((lh - base) / 2))
    })

    ctx.restore()
  }

  // --- Overlay drawing helpers ---------------------------------------------
  /**
   * Draws the empty-state overlay message in CSS pixel space using DPR scale.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} vw viewport width in CSS px
   * @param {number} vh viewport height in CSS px
   * @param {number} dpr device pixel ratio
   */
  _drawEmptyOverlay(ctx, vw, vh, dpr) {
    // Scale to CSS pixel coordinates (caller already cleared to identity)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const title = 'Choose an image to get started'
    const sub = 'Click “Upload image” or “Choose sample” to get started.'

    // Choose font sizes relative to viewport but within sensible bounds
    const base = Math.max(12, Math.min(24, Math.round(Math.min(vw, vh) * 0.04)))
    const subSize = Math.max(10, Math.round(base * 0.8))

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Title
    ctx.font = `600 ${base}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    this._drawTextWithShadow(ctx, title, vw / 2, vh / 2 - base * 0.1)

    // Subtitle
    ctx.font = `400 ${subSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    this._drawTextWithShadow(ctx, sub, vw / 2, vh / 2 + base * 1.1)

    // Draw a subtle border for context
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, vw - 1, vh - 1)
  }

  /**
   * Draws on-image hint when there is no active selection/tools yet.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} vw
   * @param {number} vh
   */
  _drawOnImageHint(ctx, vw, vh) {
    const hint = 'Press B for Brush — coming next'
    const base = Math.max(11, Math.min(18, Math.round(Math.min(vw, vh) * 0.03)))

    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.font = `500 ${base}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.9)'

    // Position near bottom center with margin
    const margin = Math.max(12, Math.round(base * 1.5))
    this._drawTextWithShadow(ctx, hint, vw / 2, vh - margin)

    // Optional: subtle border
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, vw - 1, vh - 1)
  }

  _drawTextWithShadow(ctx, text, x, y) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 2
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 1
    ctx.fillText(text, Math.round(x), Math.round(y))
    ctx.restore()
  }

  _drawDownscaleBadge(ctx, vw, vh) {
    // existing badge drawing
    const info = this._downscaleInfo
    if (!info) return
    const text = `Preview downscaled to ${info.percent}%`
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const base = Math.max(10, Math.min(13, Math.round(Math.min(vw, vh) * 0.025)))
    ctx.font = `500 ${base}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
    const padding = Math.round(base * 0.6)
    const metricsWidth = Math.ceil(ctx.measureText(text).width)
    const w = metricsWidth + padding * 2
    const h = Math.round(base * 2)
    const x = 8
    const y = 8
    // Background rounded rect
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const r = Math.min(8, Math.round(h * 0.35))
    const right = x + w
    const bottom = y + h
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(right - r, y)
    ctx.quadraticCurveTo(right, y, right, y + r)
    ctx.lineTo(right, bottom - r)
    ctx.quadraticCurveTo(right, bottom, right - r, bottom)
    ctx.lineTo(x + r, bottom)
    ctx.quadraticCurveTo(x, bottom, x, bottom - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
    ctx.fill()
    // Text
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    this._drawTextWithShadow(ctx, text, x + padding, y + Math.round((h - base) / 2))
    ctx.restore()
  }

  static get styles() {
    return css`
      :host {
        max-width: 1280px;
        margin: 0 auto;
        padding: 2rem;
        text-align: center;
        display: block;
      }
      

      .card {
        padding: 2em;
      }

      .content {
        min-height: 280px;
        border: 1px dashed #555;
        border-radius: 8px;
        display: grid;
        place-items: stretch;
        background: #111;
        padding: 1rem;
        position: relative;
      }

      .canvas-stack {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
        touch-action: none; /* prevent default touch/pan gestures interfering */
      }
      .canvas-stack .layer {
        position: absolute;
        inset: 0;
        display: block;
        image-rendering: pixelated;
      }
      .canvas-stack .overlay {
        pointer-events: none; /* overlay shouldn't capture interactions yet */
      }
      /* Hand tool cursors */
      .canvas-stack.hand {
        cursor: grab;
      }
      .canvas-stack.hand.grabbing {
        cursor: grabbing;
      }

      /* Toasts */
      .toasts {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 1000;
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        background: rgba(20,20,20,0.92);
        color: #fff;
        padding: 10px 14px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        max-width: min(90vw, 560px);
        font-size: 14px;
        line-height: 1.4;
        border: 1px solid rgba(255,255,255,0.08);
      }

      .empty {
        color: #bbb;
        place-self: center; /* center the empty state */
      }
      .empty-msg {
        margin: 0.5rem 0;
        font-size: 1.1rem;
      }
      .empty-sub {
        margin: 0;
        font-size: 0.9rem;
        color: #888;
      }

      .error {
        color: #ff6b6b;
      }

      button {
        border-radius: 8px;
        border: 1px solid transparent;
        padding: 0.6em 1.2em;
        font-size: 1em;
        font-weight: 500;
        font-family: inherit;
        background-color: #1a1a1a;
        cursor: pointer;
        transition: border-color 0.25s;
      }
      button:hover {
        border-color: #646cff;
      }
      button:focus,
      button:focus-visible {
        outline: 4px auto -webkit-focus-ring-color;
      }

      @media (prefers-color-scheme: light) {
        .content {
          background: #f7f7f7;
          border-color: #ccc;
        }
        .empty-sub {
          color: #666;
        }
        button {
          background-color: #f9f9f9;
        }
      }
    `
  }
}

window.customElements.define('my-element', MyElement)

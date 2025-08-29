import { LitElement, css, html } from 'lit'
import { ImageService } from './services/image-service.js'
import { ViewportService } from './services/viewport-service.js'

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
    // Track whether viewport was initialized for current image
    this._vpInit = false

    // Rendering loop state
    this._dirtyImage = false
    this._dirtyViewport = false
    this._dirtyOverlay = false
    this._raf = 0
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
        ${this._hasImage
          ? html`
              <div class="canvas-stack" id="canvasStack">
                <canvas id="baseCanvas" class="layer base" width="1" height="1"></canvas>
                <canvas id="overlayCanvas" class="layer overlay" width="1" height="1"></canvas>
              </div>
            `
          : html`<div class="empty">
              <p class="empty-msg">${this.docsHint}</p>
              <p class="empty-sub">Click “Upload image” or “Choose sample” to get started.</p>
            </div>`}
      </div>

      ${this._error ? html`<p class="error">${this._error}</p>` : ''}
    `
  }

  firstUpdated() {
    // Setup resize handling for DPR and container changes
    this._installResizeHandling()
    // Initial invalidate to kick the RAF loop
    this._invalidate({ image: true, viewport: true, overlay: true })
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this._teardownResizeHandling()
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
  }

  async _onChooseSample() {
    this._error = ''
    this._loading = true
    try {
      // Load via ImageService from a bundled URL
      const { working } = await ImageService.loadFromUrl(SAMPLE_IMAGE_URL)
      this._bitmap = working
      this._hasImage = !!working
    } catch (err) {
      const msg = (err && (err.isFriendly ? err.message : err.message)) || 'Failed to load sample.'
      this._error = msg
      this._hasImage = false
      this._bitmap = null
    } finally {
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
    try {
      const { working } = await ImageService.loadFromFile(file)
      this._bitmap = working
      this._hasImage = !!working
    } catch (err) {
      const msg = (err && (err.isFriendly ? err.message : err.message)) || 'Failed to load image.'
      this._error = msg
      this._hasImage = false
      this._bitmap = null
    } finally {
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

    // Example minimal overlay: draw a crisp border rectangle and center crosshair
    octx.strokeStyle = 'rgba(255,255,255,0.25)'
    octx.lineWidth = 1
    octx.strokeRect(0.5, 0.5, vw - 1, vh - 1) // 0.5 aligns stroke to pixel grid

    octx.beginPath()
    octx.moveTo((vw / 2) - 10, vh / 2)
    octx.lineTo((vw / 2) + 10, vh / 2)
    octx.moveTo(vw / 2, (vh / 2) - 10)
    octx.lineTo(vw / 2, (vh / 2) + 10)
    octx.stroke()
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
      }

      .canvas-stack {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
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

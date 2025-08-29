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
          ? html`<canvas id="baseCanvas" width="1" height="1"></canvas>`
          : html`<div class="empty">
              <p class="empty-msg">${this.docsHint}</p>
              <p class="empty-sub">Click “Upload image” or “Choose sample” to get started.</p>
            </div>`}
      </div>

      ${this._error ? html`<p class="error">${this._error}</p>` : ''}
    `
  }

  firstUpdated() {
    // If already loaded (unlikely on first paint), draw.
    this._draw()
  }

  updated(changed) {
    if (changed.has('_hasImage') || changed.has('_bitmap')) {
      // Reset viewport init when bitmap changes
      if (changed.has('_bitmap')) this._vpInit = false
      this._draw()
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

  _draw() {
    const canvas = /** @type {HTMLCanvasElement|null} */ (this.renderRoot?.getElementById('baseCanvas'))
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Make the canvas fill its container
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    // Determine viewport size from the canvas' box (CSS pixels)
    const vw = canvas.clientWidth | 0
    const vh = canvas.clientHeight | 0
    if (vw <= 0 || vh <= 0) return

    // Set canvas internal buffer size (Phase 4 will add DPR handling)
    if (canvas.width !== vw) canvas.width = vw
    if (canvas.height !== vh) canvas.height = vh

    // Clear to prepare drawing
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!this._bitmap) {
      return
    }

    // Initialize/update viewport for this image
    ViewportService.setViewportSize(vw, vh)
    ViewportService.setContentSize(this._bitmap.width, this._bitmap.height)
    if (!this._vpInit) {
      ViewportService.fitContain()
      this._vpInit = true
    } else {
      // Re-clamp to ensure pan stays valid if sizes changed
      ViewportService.clampPan()
    }

    // Apply transform and draw the image
    ViewportService.applyToContext(ctx)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this._bitmap, 0, 0)

    // Reset transform for any subsequent overlay (not yet implemented)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
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
        place-items: center;
        background: #111;
        padding: 1rem;
      }

      .empty {
        color: #bbb;
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

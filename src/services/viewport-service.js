/**
 * ViewportService: fit, zoom, pan, transforms
 *
 * Responsibilities:
 * - Maintain viewport and content (image) geometry
 * - Compute fitContain (min zoom) and center on load
 * - Clamp panning so content cannot drift beyond bounds
 * - Provide toScreen/toImage coordinate transforms
 * - Provide zoom-to-point behavior and apply transforms to a 2D context
 */

/**
 * @typedef {{x:number,y:number}} Point
 */

class ViewportServiceImpl {
  constructor() {
    // Viewport (canvas CSS pixels, not DPR-scaled)
    this.vw = 0
    this.vh = 0
    // Content (image) size in image pixels
    this.cw = 1
    this.ch = 1

    // Transform parameters: screen = image * scale + translate
    this.scale = 1
    this.tx = 0
    this.ty = 0

    // Zoom constraints
    this.minScale = 1
    this.maxScale = 8
  }

  // --- Sizing ----------------------------------------------------------------

  /**
   * Set viewport size (in screen/CSS pixels)
   * @param {number} width
   * @param {number} height
   */
  setViewportSize(width, height) {
    this.vw = Math.max(0, width | 0)
    this.vh = Math.max(0, height | 0)
    // Re-clamp pan because bounds change with viewport size
    this.clampPan()
  }

  /**
   * Set content (image) size (in image pixels)
   * @param {number} width
   * @param {number} height
   */
  setContentSize(width, height) {
    this.cw = Math.max(1, width | 0)
    this.ch = Math.max(1, height | 0)
    // Recompute min zoom when content size changes
    this._recomputeMinScale()
    this.scale = Math.max(this.scale, this.minScale)
    this.maxScale = Math.max(this.minScale * 8, this.minScale) // cap ~8x over fit
    this.clampPan()
  }

  // --- Fit & clamp ------------------------------------------------------------

  /**
   * Compute fitContain zoom and center the content within the viewport.
   * Sets scale=minScale and centers by updating tx, ty.
   */
  fitContain() {
    this._recomputeMinScale()
    this.scale = this.minScale
    // Centering translation so that content is centered within viewport
    const cwScaled = this.cw * this.scale
    const chScaled = this.ch * this.scale
    this.tx = (this.vw - cwScaled) / 2
    this.ty = (this.vh - chScaled) / 2
    // No need to clamp since this is centered by construction
  }

  _recomputeMinScale() {
    if (this.vw <= 0 || this.vh <= 0 || this.cw <= 0 || this.ch <= 0) {
      this.minScale = 1
      return
    }
    const sx = this.vw / this.cw
    const sy = this.vh / this.ch
    this.minScale = Math.min(sx, sy)
    if (!isFinite(this.minScale) || this.minScale <= 0) this.minScale = 1
    // Update max relative to new min if needed
    this.maxScale = Math.max(this.minScale * 8, this.maxScale || this.minScale * 8)
  }

  /**
   * Clamp panning so that the content cannot drift beyond bounds.
   * If content smaller than viewport, keep centered on that axis.
   */
  clampPan() {
    const cwScaled = this.cw * this.scale
    const chScaled = this.ch * this.scale

    // Horizontal
    if (cwScaled <= this.vw) {
      this.tx = (this.vw - cwScaled) / 2
    } else {
      const minTx = this.vw - cwScaled // content right touches viewport right
      const maxTx = 0 // content left touches viewport left
      if (this.tx < minTx) this.tx = minTx
      if (this.tx > maxTx) this.tx = maxTx
    }

    // Vertical
    if (chScaled <= this.vh) {
      this.ty = (this.vh - chScaled) / 2
    } else {
      const minTy = this.vh - chScaled
      const maxTy = 0
      if (this.ty < minTy) this.ty = minTy
      if (this.ty > maxTy) this.ty = maxTy
    }
  }

  // --- Zoom & Pan -------------------------------------------------------------

  /**
   * Zoom by a factor relative to current scale, anchored at screen point (sx, sy).
   * Factor > 1 zooms in, < 1 zooms out. Scale is clamped to [minScale, maxScale].
   * @param {number} factor
   * @param {number} sx
   * @param {number} sy
   */
  zoomAt(factor, sx, sy) {
    if (!isFinite(factor) || factor === 0) return
    const oldScale = this.scale
    let nextScale = oldScale * factor
    // Clamp scale
    nextScale = Math.max(this.minScale, Math.min(this.maxScale, nextScale))
    if (nextScale === oldScale) return

    // Keep the image point under (sx, sy) stable:
    // imageX = (sx - tx) / oldScale; new tx' = sx - imageX * nextScale
    const imageX = (sx - this.tx) / oldScale
    const imageY = (sy - this.ty) / oldScale
    this.scale = nextScale
    this.tx = sx - imageX * this.scale
    this.ty = sy - imageY * this.scale

    this.clampPan()
  }

  /**
   * Pan by screen-space delta.
   * @param {number} dx
   * @param {number} dy
   */
  panBy(dx, dy) {
    if (!dx && !dy) return
    this.tx += dx
    this.ty += dy
    this.clampPan()
  }

  // --- Transforms -------------------------------------------------------------

  /**
   * Convert image coordinates to screen coordinates.
   * @param {Point} p
   * @returns {Point}
   */
  toScreen(p) {
    return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty }
  }

  /**
   * Convert screen coordinates to image coordinates.
   * @param {Point} p
   * @returns {Point}
   */
  toImage(p) {
    return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale }
  }

  /**
   * Get current 2D canvas transform components compatible with setTransform.
   * @returns {[number,number,number,number,number,number]}
   */
  getTransform() {
    return [this.scale, 0, 0, this.scale, this.tx, this.ty]
  }

  /**
   * Apply current transform to a 2D canvas context.
   * @param {CanvasRenderingContext2D} ctx
   */
  applyToContext(ctx) {
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty)
  }

  /**
   * Reset transform on a 2D canvas context to identity.
   * @param {CanvasRenderingContext2D} ctx
   */
  resetContextTransform(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  // --- State helpers ----------------------------------------------------------

  /**
   * Initialize from sizes and center-fit.
   * @param {number} vw
   * @param {number} vh
   * @param {number} cw
   * @param {number} ch
   */
  initFit(vw, vh, cw, ch) {
    this.setViewportSize(vw, vh)
    this.setContentSize(cw, ch)
    this.fitContain()
  }
}

export const ViewportService = new ViewportServiceImpl()

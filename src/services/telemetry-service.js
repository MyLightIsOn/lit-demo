/**
 * TelemetryService: lightweight instrumentation
 * - Timings: start/end or one-shot mark
 * - Counters: increment by name
 * - Snapshot: return current values for debug overlay
 */
class TelemetryServiceImpl {
  constructor() {
    /** @type {Record<string, number>} */
    this._counters = Object.create(null)
    /** @type {Record<string, number>} */
    this._starts = Object.create(null)
    /** @type {Record<string, number>} */
    this._timings = Object.create(null)
    /** @type {boolean} */
    this._firstPaintMarked = false
    /** @type {Set<Function>} */
    this._listeners = new Set()
  }

  now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now()
    return Date.now()
  }

  /** Start a timer (e.g., 'imageLoad') */
  startTimer(name) {
    this._starts[name] = this.now()
    this._notify()
  }

  /** End a timer and record duration in ms */
  endTimer(name) {
    const start = this._starts[name]
    if (typeof start === 'number') {
      const dur = this.now() - start
      this._timings[name] = dur
      delete this._starts[name]
      this._notify()
      try { console.debug(`[telemetry] ${name} ${Math.round(dur)}ms`) } catch {}
      return dur
    }
    return null
  }

  /** One-shot mark with absolute timestamp */
  mark(name) {
    this._timings[name] = this.now()
    this._notify()
    try { console.debug(`[telemetry] mark ${name} at ${Math.round(this._timings[name])}ms`) } catch {}
  }

  /** Mark firstPaint once */
  markFirstPaint() {
    if (this._firstPaintMarked) return
    this._firstPaintMarked = true
    this.mark('firstPaint')
  }

  /** Increment a counter by delta (default 1) */
  increment(name, delta = 1) {
    const cur = this._counters[name] || 0
    this._counters[name] = cur + (Number.isFinite(delta) ? delta : 1)
    this._notify()
  }

  /** Get a snapshot of counters and timings */
  getSnapshot() {
    return {
      counters: { ...this._counters },
      timings: { ...this._timings },
      inFlight: { ...this._starts },
    }
  }

  reset() {
    this._counters = Object.create(null)
    this._starts = Object.create(null)
    this._timings = Object.create(null)
    this._firstPaintMarked = false
    this._notify()
  }

  /** Subscribe to changes (listener: (snapshot)=>void). Returns unsubscribe. */
  subscribe(listener) {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  _notify() {
    if (!this._listeners.size) return
    const snap = this.getSnapshot()
    this._listeners.forEach((fn) => {
      try { fn(snap) } catch {}
    })
  }
}

export const Telemetry = new TelemetryServiceImpl()

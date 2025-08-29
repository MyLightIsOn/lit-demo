import { LitElement, css, html } from 'lit'
import { Telemetry } from './services/telemetry-service.js'

/**
 * <telemetry-readout>
 * Lightweight floating panel that shows Telemetry snapshot in real-time.
 * - Toggles collapsed/expanded on click
 * - Subscribes to Telemetry service and re-renders on updates
 */
export class TelemetryReadout extends LitElement {
  static properties = {
    _collapsed: { state: true },
    _snapshot: { state: true },
  }

  constructor() {
    super()
    this._collapsed = false
    this._snapshot = Telemetry.getSnapshot()
    /** @type {null | (() => void)} */
    this._unsub = null
  }

  connectedCallback() {
    super.connectedCallback()
    // Subscribe to telemetry updates
    this._unsub = Telemetry.subscribe((snap) => {
      this._snapshot = snap
      this.requestUpdate()
    })
    // Light refresh loop for updating in-flight timer durations
    this._tick = setInterval(() => {
      if (!this.isConnected) return
      const hasInflight = this._snapshot && this._snapshot.inFlight && Object.keys(this._snapshot.inFlight).length > 0
      if (!this._collapsed && hasInflight) this.requestUpdate()
    }, 250)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    if (this._unsub) {
      try { this._unsub() } catch {}
      this._unsub = null
    }
    if (this._tick) {
      try { clearInterval(this._tick) } catch {}
      this._tick = null
    }
  }

  _toggle() {
    this._collapsed = !this._collapsed
  }

  render() {
    const { counters = {}, timings = {}, inFlight = {} } = this._snapshot || {}

    if (this._collapsed) {
      return html`
        <div class="chip" @click=${this._toggle} title="Show telemetry">⏱️ Telemetry</div>
      `
    }

    const sortedTimings = Object.entries(timings)
      .sort((a, b) => a[0].localeCompare(b[0]))
    const sortedCounters = Object.entries(counters)
      .sort((a, b) => a[0].localeCompare(b[0]))
    const sortedInflight = Object.entries(inFlight)
      .sort((a, b) => a[0].localeCompare(b[0]))

    return html`
      <div class="panel">
        <div class="header" @click=${this._toggle}>
          <div class="title">Telemetry</div>
          <button class="collapse" @click=${this._toggle} aria-label="Collapse">−</button>
        </div>
        <div class="section">
          <div class="section-title">Timings</div>
          ${sortedTimings.length ? html`
            <ul>
              ${sortedTimings.map(([k, v]) => html`<li><span class="k">${k}</span><span class="v">${Math.round(v)} ms</span></li>`)}
            </ul>
          ` : html`<div class="empty">No timings yet</div>`}
        </div>
        <div class="section">
          <div class="section-title">In-flight</div>
          ${sortedInflight.length ? html`
            <ul>
              ${sortedInflight.map(([k, start]) => {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
                const dur = Math.max(0, Math.round(now - start))
                return html`<li><span class="k">${k}</span><span class="v">${dur} ms…</span></li>`
              })}
            </ul>
          ` : html`<div class="empty">No active timers</div>`}
        </div>
        <div class="section">
          <div class="section-title">Counters</div>
          ${sortedCounters.length ? html`
            <ul>
              ${sortedCounters.map(([k, v]) => html`<li><span class="k">${k}</span><span class="v">${v}</span></li>`)}
            </ul>
          ` : html`<div class="empty">No counters yet</div>`}
        </div>
      </div>
    `
  }

  static styles = css`
    :host {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2000;
      font: 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: #fff;
      pointer-events: none; /* allow clicks to pass through except on panel */
    }
    .panel, .chip { pointer-events: auto; }

    .chip {
      background: rgba(20,20,20,0.92);
      border: 1px solid rgba(255,255,255,0.1);
      color: #fff;
      padding: 6px 10px;
      border-radius: 999px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      cursor: pointer;
      user-select: none;
    }

    .panel {
      width: min(300px, 90vw);
      background: rgba(15, 15, 18, 0.92);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .title { font-weight: 600; }
    .collapse {
      background: transparent;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .section { padding: 8px 10px; }
    .section + .section { border-top: 1px dashed rgba(255,255,255,0.08); }
    .section-title { font-weight: 600; margin-bottom: 6px; color: #ddd; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    li { display: flex; justify-content: space-between; gap: 8px; }
    .k { color: #bbb; }
    .v { color: #fff; font-variant-numeric: tabular-nums; }
    .empty { color: #888; font-style: italic; }
  `
}

customElements.define('telemetry-readout', TelemetryReadout)

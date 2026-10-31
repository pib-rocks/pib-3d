export const SHADOW_STYLES = `
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    color-scheme: dark;
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0d1117;
    color: #e6edf3;
  }
  * { box-sizing: border-box; }
  .host-root { position: relative; width: 100%; height: 100%; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; }

  .hud { position: absolute; inset: 0; pointer-events: none; }
  .hud > * { pointer-events: auto; }

  #panel { position: absolute; top: 16px; left: 16px; bottom: 16px; width: 302px;
    background: rgba(22, 27, 34, 0.92); border: 1px solid #30363d; border-radius: 10px;
    display: flex; flex-direction: column; overflow: hidden;
    backdrop-filter: blur(6px); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  #panel.hidden { display: none; }

  header { padding: 12px 14px 10px; border-bottom: 1px solid #30363d; }
  header h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: .2px; }
  header p { margin: 3px 0 0; font-size: 11px; color: #8b949e; }
  header b { color: #e6edf3; font-weight: 600; }

  #tools { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #30363d; }
  button { font: inherit; font-size: 11.5px; color: #e6edf3; background: #21262d;
    border: 1px solid #30363d; border-radius: 6px; padding: 5px 9px; cursor: pointer; }
  button:hover { background: #30363d; border-color: #484f58; }
  button.on { background: #1f6feb; border-color: #388bfd; }

  #joints { overflow-y: auto; padding: 4px 12px 16px; flex: 1; }
  #joints h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .9px;
    color: #8b949e; margin: 14px 0 6px; font-weight: 600; }
  .j { margin: 0 0 9px; }
  .j .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .j .name { font-size: 11.5px; color: #c9d1d9; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  .j .val { font-variant-numeric: tabular-nums; font-size: 11px; color: #58a6ff; min-width: 62px;
    text-align: right; }
  .j input[type=range] { width: 100%; margin: 3px 0 0; height: 14px; accent-color: #1f6feb; }
  .j.active { border-left: 2px solid #1f6feb; margin-left: -8px; padding-left: 6px; }
  .j.active .name { color: #79c0ff; }
  .j input[type=range]:focus { outline: 1px solid #388bfd; outline-offset: 3px; border-radius: 2px; }

  #stats { position: absolute; top: 16px; right: 16px; text-align: right; font-size: 11px;
    color: #8b949e; background: rgba(22,27,34,.85); border: 1px solid #30363d;
    border-radius: 8px; padding: 8px 11px; pointer-events: none; }
  #stats b { color: #e6edf3; }
  #hint { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
    font-size: 11px; color: #6e7681; pointer-events: none; }

  #info { border-top: 1px solid #30363d; padding: 8px 12px 10px; font-size: 11px;
    max-height: 40%; overflow-y: auto; display: none; }
  #info.show { display: block; }
  .irow { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 3px; }
  .irow span { color: #8b949e; }
  .irow b { color: #c9d1d9; font-weight: 500; text-align: right; word-break: break-all; }
  #info summary { cursor: pointer; color: #58a6ff; list-style: none; margin-top: 4px; }
  #info summary::-webkit-details-marker { display: none; }
  #info summary::before { content: '▸ '; }
  #info details[open] summary::before { content: '▾ '; }
  #info-list { margin: 4px 0 0; color: #8b949e; font-size: 10.5px; line-height: 1.5;
    word-break: break-all; }
  #tip { position: fixed; pointer-events: none; background: rgba(22,27,34,.95);
    border: 1px solid #30363d; border-radius: 6px; padding: 3px 7px; font-size: 11px;
    color: #e6edf3; display: none; z-index: 10; }
  #loading { position: absolute; inset: 0; display: grid; place-content: center; gap: 10px;
    background: #0d1117; text-align: center; z-index: 5; }
  #loading .bar { width: 320px; height: 4px; background: #21262d; border-radius: 3px; overflow: hidden; }
  #loading .bar i { display: block; height: 100%; width: 0; background: #1f6feb; transition: width .15s; }
  #loading .txt { font-size: 12px; color: #8b949e; }
  #loading .err { color: #f85149; max-width: 460px; font-size: 12px; white-space: pre-wrap; }
`;

export const SHADOW_HTML = `
  <div class="host-root">
    <canvas part="canvas"></canvas>
    <div class="hud">
      <aside id="panel">
        <header>
          <h1>pib — URDF-Demonstrator</h1>
          <p><b>pib.control.urdf</b> · Onshape-Export, auf Steuerungsmodell reduziert</p>
        </header>
        <div id="tools">
          <button type="button" data-action="zero">Nullstellung</button>
          <button type="button" data-action="mid">Mitte</button>
          <button type="button" data-action="grid" class="on">Gitter</button>
          <button type="button" data-action="spin">Drehen</button>
        </div>
        <div id="joints"></div>
        <div id="info">
          <div class="irow"><span>Bauteil</span><b id="info-link">–</b></div>
          <div class="irow"><span>Gelenk</span><b id="info-joint">–</b></div>
          <details>
            <summary><span id="info-summary">Teile</span></summary>
            <div id="info-list"></div>
          </details>
        </div>
      </aside>
      <div id="tip"></div>
      <div id="stats">wird geladen …</div>
      <div id="hint">Bauteil anklicken: Gelenk wählen · Maus ziehen: drehen · Rad: zoomen · Rechte Taste: verschieben</div>
    </div>
    <div id="loading">
      <div class="txt" id="load-txt">Modell wird geladen …</div>
      <div class="bar"><i id="load-bar"></i></div>
      <div class="err" id="load-err"></div>
    </div>
  </div>
`;

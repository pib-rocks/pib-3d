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
  button.danger { background: #3d1214; border-color: #f85149; color: #ffa198; }
  button.danger:hover { background: #67060c; }

  #command-bar { display: none; gap: 6px; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid #30363d; }
  #command-bar.on { display: flex; }
  .j.pending .name { color: #e3b341; }
  .j.pending .val { color: #e3b341; }

  #guard, #live-stale { display: none; margin: 10px 12px 0; padding: 8px 10px; border: 1px solid #9e6a03;
    border-radius: 6px; background: #2d2103; color: #e3b341; font-size: 11px; line-height: 1.5; }
  #guard.on, #live-stale.on { display: block; }
  #joints { overflow-y: auto; padding: 4px 12px 16px; flex: 1; }
  #joints h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .9px;
    color: #8b949e; margin: 14px 0 6px; font-weight: 600; }
  .j { margin: 0 0 9px; }
  .j .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .j .name { font-size: 11.5px; color: #c9d1d9; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1; min-width: 0; }
  .j .badge { font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px;
    padding: 1px 5px; border-radius: 4px; border: 1px solid #30363d; color: #8b949e; flex-shrink: 0; }
  .j[data-joint-class="driven"] .badge { color: #3fb950; border-color: #238636; }
  .j[data-joint-class="coupled"] .badge { color: #d29922; border-color: #9e6a03; }
  .j[data-joint-class="passive"] .badge { color: #a371f7; border-color: #8957e5; }
  .j .motor { font-size: 10px; color: #8b949e; margin: 1px 0 2px; font-family: ui-monospace, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .j .val { font-variant-numeric: tabular-nums; font-size: 11px; color: #58a6ff; min-width: 62px;
    text-align: right; }
  .j .slider { position: relative; margin: 3px 0 0; }
  .j .track { position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px;
    background: #21262d; border-radius: 2px; pointer-events: none; overflow: hidden; }
  .j .track .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0;
    background: #1f6feb; border-radius: 2px; }
  .j .track .mark.soll { position: absolute; top: -3px; width: 2px; height: 10px;
    background: #e3b341; border-radius: 1px; display: none; transform: translateX(-1px); }
  .j .track .mark.soll.on { display: block; }
  .j .cmd-delta { display: none; font-size: 10px; color: #8b949e; text-align: right; margin-top: 2px; }
  .j .cmd-delta.on { display: block; }
  .j input[type=range] { width: 100%; margin: 0; height: 14px; accent-color: transparent;
    background: transparent; position: relative; z-index: 1; }
  .j input[type=range]::-webkit-slider-runnable-track { background: transparent; }
  .j input[type=range]::-moz-range-track { background: transparent; }
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
        <div id="guard" hidden></div>
        <div id="live-stale" hidden></div>
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

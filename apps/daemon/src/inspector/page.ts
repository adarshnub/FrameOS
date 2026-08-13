export const inspectorHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FrameOS Feature Lab</title>
  <link rel="stylesheet" href="/inspector/app.css">
</head>
<body>
  <div class="grid-glow" aria-hidden="true"></div>
  <header class="topbar">
    <div>
      <div class="wordmark"><span>FRAME</span><b>/</b><span>OS</span></div>
      <p>Feature Lab / implemented-surface tester</p>
    </div>
    <div class="top-actions"><a href="/">Product site ↗</a><div id="connection-state" class="signal offline"><i></i><span>OFFLINE</span></div></div>
  </header>

  <main class="shell">
    <section class="panel link-panel" aria-labelledby="link-title">
      <div class="panel-head"><span>00</span><h1 id="link-title">Daemon link</h1></div>
      <label>API origin<input id="base-url" value="http://127.0.0.1:31415" spellcheck="false"></label>
      <label>Bearer token<input id="token" type="password" autocomplete="off" placeholder="Paste .frameos-data/auth-token"></label>
      <button id="connect">Connect</button>
      <output id="notice" aria-live="polite">Token stays in this browser tab.</output>
    </section>

    <section class="metrics" aria-label="Completion overview">
      <article class="metric panel"><small>Low-level executable</small><strong id="metric-implemented">--</strong><span>transaction operations</span></article>
      <article class="metric panel"><small>Service workflows</small><strong id="metric-service">--</strong><span>API/MCP operations</span></article>
      <article class="metric panel"><small>Remaining contracts</small><strong id="metric-contract">--</strong><span>not executable yet</span></article>
      <article class="metric panel"><small>Runtime available</small><strong id="metric-available">--</strong><span>host capabilities</span></article>
      <article class="metric panel"><small>Runtime gated</small><strong id="metric-gated">--</strong><span>explicit unavailable gates</span></article>
    </section>

    <section class="workspace" aria-label="Feature lab workspace">
      <aside class="panel projects">
        <div class="panel-head"><span>01</span><h2>Projects</h2><button id="refresh-projects" class="ghost" title="Refresh">Refresh</button></div>
        <form id="create-project" class="row-form">
          <input id="project-name" placeholder="New project name" maxlength="1024">
          <button>Create</button>
        </form>
        <nav id="project-list" aria-label="Projects"><p class="empty">Connect to enumerate project bundles.</p></nav>
      </aside>

      <section class="panel lab">
        <div class="panel-head"><span>02</span><h2>Implemented Feature Tests</h2><div id="revision" class="badge">REV --</div></div>
        <div class="test-grid">
          <button class="test-card" data-test="health"><b>Health + catalog</b><span>Checks daemon, operations, capabilities.</span></button>
          <button class="test-card" data-test="metadata"><b>Commit metadata</b><span>Runs a real transaction and revision bump.</span></button>
          <button class="test-card" data-test="marker-title"><b>Marker + title</b><span>Adds timeline state without media files.</span></button>
          <button class="test-card" data-test="captions"><b>Captions round trip</b><span>Imports WebVTT and exports SRT.</span></button>
          <button class="test-card" data-test="semantic"><b>Semantic plans</b><span>Generates non-mutating edit plans.</span></button>
          <button class="test-card" data-test="otio"><b>OTIO round trip</b><span>Exports and reimports editorial subset.</span></button>
          <button class="test-card" data-test="render-gate"><b>Render gate</b><span>Starts render and observes capability status.</span></button>
          <button class="test-card" data-test="agent-gate"><b>Agent gate</b><span>Creates session and checks provider availability.</span></button>
        </div>
        <div class="lab-output">
          <div class="lab-output-head">
            <strong>Run log</strong>
            <button id="clear-log" class="ghost">Clear</button>
          </div>
          <ol id="run-log" class="run-log"><li class="muted">No tests run yet.</li></ol>
        </div>
      </section>

      <aside class="panel catalog">
        <div class="panel-head"><span>03</span><h2>Surface Matrix</h2></div>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="true" data-tab="operations">Operations</button>
          <button role="tab" aria-selected="false" data-tab="capabilities">Capabilities</button>
          <button role="tab" aria-selected="false" data-tab="jobs">Jobs</button>
        </div>
        <input id="catalog-search" type="search" placeholder="Filter by name, family, status" aria-label="Filter catalog">
        <div id="catalog-list" class="catalog-list"><p class="empty">Connect to load machine surface.</p></div>
      </aside>

      <section class="panel manual asset-tools">
        <div class="panel-head"><span>04</span><h2>Asset + Analysis</h2></div>
        <p class="hint">Choose a file to import it directly from Windows as a managed project asset. Absolute paths remain available for advanced external-file imports inside configured media roots.</p>
        <label class="file-picker">Choose media from this computer<input id="asset-file" type="file" accept="video/*,audio/*,image/*,.srt,.vtt,.ass,.ssa,.ttf,.otf,.woff,.woff2"><span id="asset-file-label">No file selected</span></label>
        <div class="path-divider"><span>OR USE AN EXTERNAL PATH</span></div>
        <label>Media path or file URI<input id="asset-uri" placeholder="C:\path\to\existing-media.mp4" spellcheck="false"></label>
        <div class="split">
          <label>Asset kind<select id="asset-kind"><option value="">Infer from extension</option><option>video</option><option>audio</option><option>image</option><option>subtitle</option><option>font</option></select></label>
          <label class="check"><input id="asset-managed" type="checkbox"> Managed copy</label>
        </div>
        <div class="actions">
          <button id="import-asset">Import asset</button>
          <button id="analyze-asset">Analyze selected asset</button>
          <button id="search-analysis">Search analysis</button>
        </div>
        <output id="asset-result">Select a project first.</output>
      </section>

      <section class="panel manual transaction">
        <div class="panel-head"><span>05</span><h2>Transaction Console</h2><div class="mode-switch" role="group" aria-label="Transaction mode"><button data-mode="validate" class="active">Validate</button><button data-mode="preview">Preview</button><button data-mode="commit">Commit</button></div></div>
        <textarea id="transaction-json" spellcheck="false" aria-label="Transaction operations JSON">[
  {
    "operationId": "auto",
    "type": "project.metadata.set",
    "preconditions": [],
    "arguments": {
      "values": {
        "testedFrom": "feature-lab"
      }
    }
  }
]</textarea>
        <div class="actions">
          <button id="execute" disabled>Execute against current revision</button>
          <button id="load-selected-json" class="ghost">Show project JSON</button>
        </div>
        <pre id="project-json" tabindex="0">{
  "status": "waiting_for_project"
}</pre>
      </section>
    </section>

    <section class="control-grid" aria-label="Agent and observability controls">
      <section class="panel agent-workbench">
        <div class="panel-head"><span>06</span><h2>Agent Workbench</h2><div id="provider-state" class="badge">NO PROVIDER</div></div>
        <p class="hint">The model creates a structured plan against the selected project's real state and capability catalog. It does not commit edits during planning.</p>
        <div class="agent-config">
          <label>Configured provider<select id="agent-provider"><option value="">Connect to discover providers</option></select></label>
          <label>Approval mode<select id="agent-approval"><option value="supervised">Supervised</option><option value="propose">Propose only</option><option value="autonomous">Autonomous</option></select></label>
          <label>Cost budget (USD)<input id="agent-cost-budget" type="number" min="0" step="0.001" value="0.10"></label>
        </div>
        <label>Edit request<textarea id="agent-request" placeholder="Example: Create a concise 30-second opening, remove long pauses, and add readable captions."></textarea></label>
        <div class="actions"><button id="agent-plan">Create plan</button><button id="agent-execute" disabled>Preview operations</button><button id="agent-approve" class="approve" disabled>Approve draft</button><button id="agent-reject" class="danger" disabled>Reject draft</button></div>
        <label>Low-level operations for execute<textarea id="agent-operations">[
  {
    "operationId": "auto",
    "type": "project.metadata.set",
    "preconditions": [],
    "arguments": { "values": { "agentTested": true } }
  }
]</textarea></label>
        <pre id="agent-result">{
  "status": "waiting_for_provider"
}</pre>
      </section>

      <aside class="panel usage-panel">
        <div class="panel-head"><span>07</span><h2>AI Cost Ledger</h2><button id="refresh-usage" class="ghost">Refresh</button></div>
        <div class="usage-total"><small>Estimated spend</small><strong id="usage-cost">$0.000000</strong><span id="usage-requests">0 provider requests</span></div>
        <div class="usage-stats"><div><b id="usage-input">0</b><span>input tokens</span></div><div><b id="usage-cached">0</b><span>cached tokens</span></div><div><b id="usage-output">0</b><span>output tokens</span></div></div>
        <div class="provider-note"><b>What uses the API key?</b><p>Only built-in agent planning currently calls the configured OpenAI Responses API. Deterministic edits, validation, previews, analysis plugins, MLT/FFmpeg processing, MCP, and rendering do not use it.</p><p>Default model: <code>gpt-4.1-mini</code>. Keys stay server-side in <code>FRAMEOS_OPENAI_API_KEY</code> and are never returned to this page.</p></div>
        <div id="usage-records" class="usage-records"><p class="empty">No provider usage recorded.</p></div>
      </aside>

      <section class="panel api-console">
        <div class="panel-head"><span>08</span><h2>Raw API Console</h2><div class="badge">FULL REST SURFACE</div></div>
        <p class="hint">Invoke any implemented REST workflow with the same bearer token. Use the operation catalog and transaction console above for low-level edits; use this console for previews, semantic planners, jobs, approvals, interchange, and other service endpoints.</p>
        <div class="api-request-line"><select id="api-method"><option>GET</option><option>POST</option><option>DELETE</option></select><input id="api-path" value="/api/v1/capabilities" spellcheck="false"><button id="api-send">Send request</button></div>
        <textarea id="api-body" spellcheck="false" aria-label="Raw API request body">{}</textarea>
        <pre id="api-result">{
  "status": "ready"
}</pre>
      </section>

      <section class="panel realtime-logs">
        <div class="panel-head"><span>09</span><h2>Live Operations Log</h2><div id="log-stream-state" class="badge">DISCONNECTED</div></div>
        <div class="log-toolbar"><select id="log-level"><option value="">All levels</option><option value="success">Success</option><option value="info">Info</option><option value="warn">Warnings</option><option value="error">Errors</option></select><input id="log-search" type="search" placeholder="Filter event, message, payload"><button id="log-pause" class="ghost">Pause</button><button id="log-clear" class="ghost">Clear view</button></div>
        <div class="log-columns"><span>TIME</span><span>LEVEL</span><span>EVENT / MESSAGE</span><span>DURATION</span></div>
        <ol id="system-log" class="system-log"><li class="empty">Connect to stream structured daemon logs.</li></ol>
      </section>
    </section>
  </main>
  <script src="/inspector/app.js" defer></script>
</body>
</html>`;

export const inspectorCss = String.raw`
:root{--ink:#11140f;--paper:#eee7d7;--panel:#f7f0df;--muted:#8a8679;--line:#26291f;--line-soft:#d6cdbc;--acid:#d8ff3e;--blue:#77d7ff;--red:#ef4d37;--green:#55d679;--orange:#ff5b22;--mono:"Cascadia Mono","JetBrains Mono","SFMono-Regular",monospace;--display:"Bodoni 72","Bodoni MT","Didot",serif}
*{box-sizing:border-box}html{background:var(--ink)}body{margin:0;min-height:100vh;color:var(--ink);font-family:var(--mono);background:radial-gradient(circle at 12% -10%,rgba(216,255,62,.22),transparent 28rem),radial-gradient(circle at 88% 8%,rgba(119,215,255,.16),transparent 24rem),var(--ink)}a{color:inherit}button,input,textarea,select{font:inherit}.grid-glow{position:fixed;inset:0;pointer-events:none;opacity:.08;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,#000,transparent 82%)}.topbar{height:82px;padding:0 28px;color:var(--paper);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #35382f}.wordmark{font-family:var(--display);font-size:32px;letter-spacing:-.07em;line-height:1}.wordmark b{font-family:var(--mono);color:var(--acid);padding:0 5px}.topbar p{margin:7px 0 0;color:#a9aa9f;font-size:10px;letter-spacing:.18em;text-transform:uppercase}.top-actions{display:flex;gap:24px;align-items:center}.top-actions>a{font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:.14em;text-decoration:none}.top-actions>a:hover{color:var(--acid)}.signal{display:flex;align-items:center;gap:9px;font-size:10px;letter-spacing:.16em}.signal i{width:9px;height:9px;border-radius:50%;background:var(--red);box-shadow:0 0 18px var(--red)}.signal.online i{background:var(--acid);box-shadow:0 0 18px var(--acid)}
.shell{padding:18px}.panel{background:var(--panel);border:1px solid var(--line);box-shadow:6px 6px 0 #000}.panel-head{min-height:48px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;padding:0 14px}.panel-head>span{font-size:10px;background:var(--ink);color:var(--acid);padding:4px 7px}.panel-head h1,.panel-head h2{font-family:var(--display);font-size:22px;font-weight:600;letter-spacing:-.035em;margin:0}.panel-head .badge,.panel-head .ghost{margin-left:auto}.link-panel{display:grid;grid-template-columns:220px minmax(220px,1fr) minmax(260px,1.2fr) 130px minmax(180px,.9fr);align-items:end;margin-bottom:16px}.link-panel .panel-head{height:74px;border-bottom:0;border-right:1px solid var(--line)}label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.13em;padding:10px 12px;color:#55584e}input,textarea,select{display:block;width:100%;margin-top:5px;color:var(--ink);background:transparent;border:0;border-bottom:1px solid var(--muted);padding:10px 2px 7px;outline:none}select{padding:8px 2px}input:focus,textarea:focus,select:focus{border-color:var(--ink);box-shadow:0 2px 0 var(--acid)}button{border:0;background:var(--ink);color:var(--paper);padding:11px 13px;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.08em;cursor:pointer}button:hover,button:focus-visible{color:var(--acid);outline:2px solid var(--acid);outline-offset:-2px}button:disabled{opacity:.35;cursor:not-allowed}.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);padding:8px 10px}.ghost:hover{background:var(--acid);color:var(--ink)}.link-panel>button{margin:0 12px 12px}.link-panel output{font-size:10px;color:#5f6258;padding:0 14px 14px;line-height:1.4}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:12px;margin-bottom:16px}.metric{padding:14px;min-height:104px;position:relative;overflow:hidden}.metric:after{content:"";position:absolute;right:-28px;top:-32px;width:90px;height:90px;border:1px solid rgba(17,20,15,.18);transform:rotate(20deg)}.metric small{display:block;color:#666a5e;text-transform:uppercase;letter-spacing:.12em;font-size:9px}.metric strong{display:block;font-family:var(--display);font-size:42px;line-height:1;margin-top:12px}.metric span{font-size:10px;color:#666a5e}.workspace{display:grid;grid-template-columns:minmax(230px,.86fr) minmax(470px,1.75fr) minmax(300px,1.05fr);grid-template-rows:minmax(560px,64vh) minmax(500px,48vh);gap:16px}.projects,.catalog{grid-row:1/3}.row-form{display:flex;gap:8px;padding:12px;border-bottom:1px solid var(--line-soft)}.row-form input{margin:0}.projects nav{padding:8px;overflow:auto;max-height:calc(100% - 112px)}.project{width:100%;text-align:left;background:transparent;color:var(--ink);border-bottom:1px solid var(--line-soft);padding:14px 10px}.project:hover,.project.active{background:var(--acid);outline:0;color:var(--ink)}.project b{display:block;text-transform:none;font-size:12px;letter-spacing:0}.project small{display:block;color:#64685c;margin-top:6px}.empty,.hint,.muted{font-size:10px;color:#6c7065;line-height:1.6}.empty{padding:10px}.badge{border:1px solid var(--line);font-size:9px;padding:4px 8px}.test-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px}.test-card{min-height:104px;background:#181b14;color:var(--paper);text-align:left;border:1px solid #000;box-shadow:4px 4px 0 #000;display:flex;flex-direction:column;justify-content:space-between}.test-card b{font-family:var(--display);font-size:20px;letter-spacing:-.03em;text-transform:none}.test-card span{font-weight:400;line-height:1.45;color:#bfc2b5;text-transform:none;letter-spacing:0}.test-card[data-state=pass]{background:#10351d}.test-card[data-state=fail]{background:#3c1711}.test-card[data-state=gate]{background:#3d3713}.lab-output{margin:0 14px 14px;border:1px solid var(--line);background:#151811;color:#dfe7cf}.lab-output-head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #3a3e33}.lab-output-head .ghost{color:var(--paper);border-color:#596052}.run-log{height:206px;overflow:auto;margin:0;padding:12px 12px 12px 34px;font-size:11px;line-height:1.55}.run-log li{margin-bottom:8px}.run-log .pass{color:#91f7a8}.run-log .fail{color:#ff9b8d}.run-log .gate{color:#f1df72}.tabs{display:flex;border-bottom:1px solid var(--line)}.tabs button{flex:1;background:transparent;color:var(--ink);border-right:1px solid var(--line)}.tabs button[aria-selected=true]{background:var(--acid)}#catalog-search{width:calc(100% - 24px);margin:9px 12px}.catalog-list{height:calc(100% - 132px);overflow:auto;padding:0 12px 12px}.catalog-item{padding:12px 0;border-bottom:1px solid var(--line-soft)}.catalog-item b{display:block;font-size:11px;overflow-wrap:anywhere}.catalog-item p{font-size:9px;line-height:1.5;color:#65695f;margin:6px 0}.tag{display:inline-block;font-size:8px;margin:2px 5px 2px 0;padding:3px 6px;border:1px solid var(--muted)}.tag.yes{background:var(--acid);border-color:var(--line)}.tag.no{background:#ded5c6;color:#77493f}.tag.service{background:var(--blue);border-color:var(--line);color:#10202a}.tag.contract{background:#e3d6cb;color:#6d4b41}.manual{min-width:0}.manual .hint{padding:12px 14px 0;margin:0}.file-picker{margin:12px;border:1px dashed var(--line);background:#ebe3d2;padding:14px;cursor:pointer}.file-picker input{position:absolute;width:1px;height:1px;opacity:0}.file-picker:focus-within,.file-picker:hover{background:var(--acid)}.file-picker span{display:block;margin-top:9px;font:16px var(--display);text-transform:none;letter-spacing:0;overflow-wrap:anywhere}.path-divider{display:flex;align-items:center;gap:8px;color:#777a70;font-size:8px;letter-spacing:.12em;padding:0 12px}.path-divider:before,.path-divider:after{content:"";height:1px;background:var(--line-soft);flex:1}.split{display:grid;grid-template-columns:1fr 150px}.check{display:flex;align-items:end;gap:8px;padding-bottom:18px}.check input{width:auto;margin:0}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px}.manual output{display:block;padding:0 14px 14px;font-size:10px;color:#5d6257;line-height:1.5}.transaction{grid-column:2}.mode-switch{display:flex;margin-left:auto}.mode-switch button{padding:7px 9px;background:transparent;color:var(--ink);border:1px solid var(--line);margin-left:-1px}.mode-switch button.active{background:var(--ink);color:var(--acid)}textarea{height:150px;resize:vertical;margin:0;padding:13px;background:#151811;color:#dfe7cf;border-bottom:1px solid #353a30}pre{height:165px;overflow:auto;margin:0;padding:14px;background:#151811;color:#dfe7cf;font:11px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word}
.control-grid{display:grid;grid-template-columns:minmax(570px,1.7fr) minmax(330px,.8fr);gap:16px;margin-top:16px}.agent-workbench,.usage-panel,.api-console,.realtime-logs{min-width:0}.agent-workbench .hint{margin:0;padding:13px 14px 0}.agent-config{display:grid;grid-template-columns:1.2fr 1fr .8fr}.agent-workbench>label{padding-top:5px}.agent-workbench textarea{height:112px;margin-top:7px}.agent-workbench pre{height:230px}.agent-workbench .approve{background:#123a20}.agent-workbench .danger{background:#481910}.usage-total{padding:20px 16px;border-bottom:1px solid var(--line)}.usage-total small{font-size:9px;text-transform:uppercase;letter-spacing:.13em;color:#686b60}.usage-total strong{display:block;font:44px/1 var(--display);margin:12px 0 4px}.usage-total span{font-size:9px;color:#686b60}.usage-stats{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--line)}.usage-stats div{padding:14px;border-right:1px solid var(--line)}.usage-stats div:last-child{border:0}.usage-stats b,.usage-stats span{display:block}.usage-stats b{font-size:16px}.usage-stats span{font-size:8px;color:#6d7067;margin-top:6px}.provider-note{padding:16px;border-bottom:1px solid var(--line)}.provider-note>b{font:21px var(--display)}.provider-note p{font-size:9px;line-height:1.65;color:#5f6259}.provider-note code{background:#ded7c7;padding:2px 4px}.usage-records{height:176px;overflow:auto;padding:0 14px}.usage-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:11px 0;border-bottom:1px solid var(--line-soft);font-size:9px}.usage-row b,.usage-row span{display:block}.usage-row span{color:#686c61;margin-top:4px}.usage-row strong{color:#1e6a34}.api-console{grid-column:1/3}.api-console .hint{padding:12px 14px 0;margin:0}.api-request-line{display:grid;grid-template-columns:120px 1fr auto;gap:12px;align-items:end;padding:12px}.api-request-line select,.api-request-line input{margin:0}.api-console textarea{height:130px}.api-console pre{height:230px}.realtime-logs{grid-column:1/3;background:#121510;color:#dce3d3}.realtime-logs .panel-head{border-color:#3c4037}.realtime-logs .panel-head>span{background:var(--acid);color:var(--ink)}.realtime-logs .panel-head .badge{border-color:#555b4e;margin-left:auto;color:#969d8d}.log-toolbar{display:grid;grid-template-columns:170px 1fr auto auto;align-items:end;padding:10px 12px;border-bottom:1px solid #34382f}.log-toolbar select,.log-toolbar input{color:#dce3d3;border-color:#565c4f;margin:0}.log-toolbar .ghost{color:#dce3d3;border-color:#565c4f}.log-columns,.system-log li{display:grid;grid-template-columns:95px 74px minmax(0,1fr) 85px;gap:12px}.log-columns{padding:8px 14px;color:#70786a;font-size:8px;letter-spacing:.13em;border-bottom:1px solid #34382f}.system-log{height:400px;overflow:auto;margin:0;padding:0;list-style:none}.system-log li{padding:9px 14px;border-bottom:1px solid #282c25;font-size:9px;line-height:1.45;align-items:start}.system-log time{color:#737b6d}.system-log .level{text-transform:uppercase;font-weight:700}.system-log .message{overflow-wrap:anywhere}.system-log .message b{display:block;color:#e8eddf}.system-log .message span{display:block;color:#858d7f;margin-top:3px;white-space:pre-wrap}.system-log .duration{color:#737b6d;text-align:right}.system-log li[data-level=success] .level{color:#82e99c}.system-log li[data-level=error] .level{color:#ff806c}.system-log li[data-level=warn] .level{color:#ecd972}.system-log li[data-level=info] .level{color:#73cdec}
@media(max-width:1180px){.link-panel{grid-template-columns:1fr 1fr}.link-panel .panel-head{grid-column:1/3;border-right:0;border-bottom:1px solid var(--line)}.metrics{grid-template-columns:repeat(3,1fr)}.workspace{grid-template-columns:260px 1fr;grid-template-rows:auto auto auto}.catalog{grid-row:3;grid-column:1/3}.projects{grid-row:1/3}.asset-tools,.transaction{grid-column:2}.catalog-list{height:360px}.control-grid{grid-template-columns:1fr}.api-console,.realtime-logs{grid-column:1}.agent-config{grid-template-columns:1fr 1fr}}@media(max-width:760px){.topbar{padding:0 16px}.topbar p,.top-actions>a{display:none}.link-panel,.metrics,.workspace,.test-grid,.split,.control-grid,.agent-config,.api-request-line{display:block}.panel{margin-bottom:14px}.projects nav,.catalog-list{max-height:none;height:320px}.test-card{margin-bottom:10px}.signal span{display:none}.api-request-line>*{margin-bottom:10px}.log-toolbar{grid-template-columns:1fr 1fr}.log-columns,.system-log li{grid-template-columns:66px 58px minmax(0,1fr)}.log-columns span:last-child,.system-log .duration{display:none}}
@media(prefers-reduced-motion:no-preference){.panel{animation:rise .32s both}.metrics .panel:nth-child(2){animation-delay:.04s}.metrics .panel:nth-child(3){animation-delay:.08s}.metrics .panel:nth-child(4){animation-delay:.12s}.metrics .panel:nth-child(5){animation-delay:.16s}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
`;

export const inspectorJavaScript = String.raw`
(function(){
  "use strict";
  var state={
    baseUrl:"",
    token:"",
    project:null,
    selectedAssetId:null,
    providers:[],
    currentRun:null,
    approvalId:null,
    logSocket:null,
    logs:[],
    logsPaused:false,
    tab:"operations",
    mode:"validate",
    catalog:{operations:[],capabilities:[],jobs:[]}
  };
  var el=function(id){return document.getElementById(id);};
  var now=function(){return new Date().toISOString();};
  var id=function(){return crypto.randomUUID();};
  function envelopeText(error){return error && error.message ? error.message : String(error);}
  function notice(message,error){el("notice").textContent=message;el("notice").style.color=error?"#b42f22":"#5d6057";}
  function setConnected(value){var node=el("connection-state");node.classList.toggle("online",value);node.classList.toggle("offline",!value);node.querySelector("span").textContent=value?"LINKED":"OFFLINE";}
  async function api(method,path,body){
    var response=await fetch(state.baseUrl+path,{method:method,headers:{authorization:"Bearer "+state.token,accept:"application/json",...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    var envelope=await response.json().catch(function(){return {data:null,error:{code:"BAD_RESPONSE",message:response.statusText},meta:{}};});
    if(!response.ok||envelope.error){var error=envelope.error||{code:"HTTP_"+response.status,message:response.statusText};throw new Error((error.code?error.code+": ":"")+error.message);}
    return {data:envelope.data,meta:envelope.meta||{}};
  }
  function uploadApi(path,file){
    return new Promise(function(resolve,reject){
      var request=new XMLHttpRequest();
      request.open("POST",state.baseUrl+path);
      request.setRequestHeader("authorization","Bearer "+state.token);
      request.setRequestHeader("accept","application/json");
      request.upload.addEventListener("progress",function(event){if(event.lengthComputable){var percent=Math.round(event.loaded/event.total*100);el("asset-result").textContent="Uploading "+file.name+" · "+percent+"%";}});
      request.addEventListener("load",function(){var envelope;try{envelope=JSON.parse(request.responseText);}catch(_error){reject(new Error("BAD_RESPONSE: Upload returned invalid JSON"));return;}if(request.status<200||request.status>=300||envelope.error){var error=envelope.error||{code:"HTTP_"+request.status,message:request.statusText};reject(new Error((error.code?error.code+": ":"")+error.message));return;}resolve({data:envelope.data,meta:envelope.meta||{}});});
      request.addEventListener("error",function(){reject(new Error("Upload connection failed"));});
      request.addEventListener("abort",function(){reject(new Error("Upload was cancelled"));});
      var form=new FormData();form.append("file",file,file.name);request.send(form);
    });
  }
  function log(message,status,details){
    var list=el("run-log");
    if(list.querySelector(".muted")) list.textContent="";
    var item=document.createElement("li");
    item.className=status||"";
    item.textContent=message+(details?" :: "+details:"");
    list.prepend(item);
  }
  function setCard(name,status){
    var card=document.querySelector("[data-test='"+name+"']");
    if(card) card.dataset.state=status||"";
  }
  function selectedSequence(){
    if(!state.project) throw new Error("Select a project first.");
    return state.project.sequences[state.project.settings.defaultSequenceId];
  }
  function selectedVideoTrack(){
    var sequence=selectedSequence();
    var track=sequence.tracks.find(function(candidate){return candidate.kind==="video";});
    if(!track) throw new Error("Project has no video track.");
    return track;
  }
  function time(value){return {value:value,rate:selectedSequence().format.frameRate};}
  async function loadProject(projectId){
    var loaded=await api("GET","/api/v1/projects/"+encodeURIComponent(projectId));
    state.project=loaded.data;
    el("revision").textContent="REV "+state.project.revision;
    el("project-json").textContent=JSON.stringify(state.project,null,2);
    el("execute").disabled=false;
    return state.project;
  }
  async function refreshProjects(){
    var response=await api("GET","/api/v1/projects");
    renderProjects(response.data||[]);
    return response.data||[];
  }
  function renderProjects(projects){
    var list=el("project-list");
    list.textContent="";
    if(!projects.length){list.innerHTML='<p class="empty">No project bundles found.</p>';return;}
    projects.forEach(function(project){
      var button=document.createElement("button");
      button.className="project"+(state.project&&state.project.projectId===project.projectId?" active":"");
      var title=document.createElement("b");
      title.textContent=project.name||project.settings&&project.settings.name||"Untitled";
      var info=document.createElement("small");
      info.textContent="REV "+project.revision+" / "+project.projectId.slice(0,8);
      button.append(title,info);
      button.addEventListener("click",async function(){try{await loadProject(project.projectId);await refreshProjects();log("Project selected","pass",project.projectId);}catch(error){log("Project load failed","fail",envelopeText(error));}});
      list.append(button);
    });
  }
  function updateMetrics(){
    var operations=state.catalog.operations;
    var capabilities=state.catalog.capabilities;
    el("metric-implemented").textContent=operations.filter(function(op){return op.maturity==="implemented";}).length;
    el("metric-service").textContent=operations.filter(function(op){return op.maturity==="service";}).length;
    el("metric-contract").textContent=operations.filter(function(op){return op.maturity==="contract"||op.maturity==="planned";}).length;
    el("metric-available").textContent=capabilities.filter(function(cap){return cap.available===true;}).length;
    el("metric-gated").textContent=capabilities.filter(function(cap){return cap.available===false;}).length;
  }
  function tag(text,kind){
    var span=document.createElement("span");
    span.className="tag "+(kind||"");
    span.textContent=text;
    return span;
  }
  function renderCatalog(){
    var query=el("catalog-search").value.trim().toLowerCase();
    var list=el("catalog-list");
    list.textContent="";
    var items=state.catalog[state.tab]||[];
    items=items.filter(function(item){return query===""||JSON.stringify(item).toLowerCase().indexOf(query)>=0;});
    items.slice(0,600).forEach(function(item){
      var box=document.createElement("article");
      box.className="catalog-item";
      var name=document.createElement("b");
      name.textContent=item.name||item.id||item.kind||"record";
      var description=document.createElement("p");
      description.textContent=item.description||item.status||"";
      box.append(name,description);
      if(state.tab==="operations"){
        box.append(tag(String(item.maturity).toUpperCase(),item.maturity==="implemented"?"yes":item.maturity==="service"?"service":"contract"),tag(item.family||"operation",""));
        if(item.maturity==="implemented"){
          box.tabIndex=0;
          box.title="Load this operation into the transaction console";
          box.addEventListener("click",function(){el("transaction-json").value=JSON.stringify([{operationId:"auto",type:item.name,preconditions:[],arguments:{}}],null,2);api("GET","/api/v1/operations/"+encodeURIComponent(item.name)).then(function(detail){el("project-json").textContent=JSON.stringify(detail.data,null,2);}).catch(function(){});log("Loaded operation and schema into transaction console","service",item.name);});
        }
      }else if(state.tab==="capabilities"){
        box.append(tag(item.available?"AVAILABLE":"GATED",item.available?"yes":"no"),tag(item.kind||"capability",""));
      }else{
        box.append(tag(String(item.status||"unknown").toUpperCase(),item.status==="completed"?"yes":item.status==="failed"?"no":"service"),tag(item.kind||"job",""));
      }
      list.append(box);
    });
    if(!items.length) list.innerHTML='<p class="empty">No matching records.</p>';
  }
  async function refreshSurface(){
    var values=await Promise.all([api("GET","/api/v1/operations"),api("GET","/api/v1/capabilities"),api("GET","/api/v1/jobs").catch(function(){return {data:[]};})]);
    state.catalog.operations=values[0].data||[];
    state.catalog.capabilities=values[1].data||[];
    state.catalog.jobs=values[2].data||[];
    updateMetrics();
    renderCatalog();
  }
  function renderProviders(){
    var select=el("agent-provider");
    select.textContent="";
    if(!state.providers.length){var empty=document.createElement("option");empty.value="";empty.textContent="No built-in provider configured";select.append(empty);el("provider-state").textContent="NO PROVIDER";return;}
    state.providers.forEach(function(provider,index){var option=document.createElement("option");option.value=String(index);option.textContent=provider.kind+" / "+provider.model;select.append(option);});
    el("provider-state").textContent=state.providers.length+" READY";
  }
  async function refreshProviders(){
    state.providers=(await api("GET","/api/v1/agents/providers")).data||[];
    renderProviders();
  }
  function formatNumber(value){return Number(value||0).toLocaleString();}
  async function refreshUsage(){
    var suffix=state.project?"?projectId="+encodeURIComponent(state.project.projectId):"";
    var usage=(await api("GET","/api/v1/admin/usage"+suffix)).data;
    el("usage-cost").textContent="$"+Number(usage.summary.estimatedCostUsd||0).toFixed(6);
    el("usage-requests").textContent=formatNumber(usage.summary.requests)+" provider request"+(usage.summary.requests===1?"":"s")+(usage.summary.unpricedRequests?" · "+usage.summary.unpricedRequests+" unpriced":"");
    el("usage-input").textContent=formatNumber(usage.summary.inputTokens);
    el("usage-cached").textContent=formatNumber(usage.summary.cachedInputTokens);
    el("usage-output").textContent=formatNumber(usage.summary.outputTokens);
    var list=el("usage-records");list.textContent="";
    (usage.records||[]).forEach(function(record){var row=document.createElement("div");row.className="usage-row";var info=document.createElement("div");var title=document.createElement("b");title.textContent=record.model+" · "+record.operation;var detail=document.createElement("span");detail.textContent=formatNumber(record.totalTokens)+" tokens · "+new Date(record.createdAt).toLocaleString();info.append(title,detail);var cost=document.createElement("strong");cost.textContent=record.estimatedCostUsd===undefined?"UNPRICED":"$"+Number(record.estimatedCostUsd).toFixed(6);row.append(info,cost);list.append(row);});
    if(!usage.records||!usage.records.length)list.innerHTML='<p class="empty">No provider usage recorded.</p>';
  }
  function logMatches(entry){var level=el("log-level").value;var search=el("log-search").value.trim().toLowerCase();return(!level||entry.level===level)&&(!search||JSON.stringify(entry).toLowerCase().indexOf(search)>=0);}
  function renderSystemLogs(){
    var list=el("system-log");list.textContent="";
    state.logs.filter(logMatches).slice(0,1000).forEach(function(entry){var row=document.createElement("li");row.dataset.level=entry.level;var timeNode=document.createElement("time");timeNode.dateTime=entry.occurredAt;timeNode.textContent=new Date(entry.occurredAt).toLocaleTimeString([], {hour12:false});var level=document.createElement("span");level.className="level";level.textContent=entry.level;var message=document.createElement("span");message.className="message";var title=document.createElement("b");title.textContent=entry.eventType;var detail=document.createElement("span");var payload=JSON.stringify(entry.data);detail.textContent=entry.message+(payload&&payload!=="{}"?" · "+payload.slice(0,700):"");message.append(title,detail);var duration=document.createElement("span");duration.className="duration";duration.textContent=entry.durationMs===undefined?"—":Number(entry.durationMs).toFixed(1)+" ms";row.append(timeNode,level,message,duration);list.append(row);});
    if(!list.children.length)list.innerHTML='<li class="empty">No matching log records.</li>';
  }
  async function refreshLogs(){state.logs=(await api("GET","/api/v1/admin/logs?limit=1000")).data||[];renderSystemLogs();}
  function openLogStream(){
    if(state.logSocket)state.logSocket.close();
    var url=state.baseUrl.replace(/^http/,"ws")+"/api/v1/admin/logs/stream";
    var encoded=btoa(unescape(encodeURIComponent(state.token))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
    var socket=new WebSocket(url,["frameos","frameos-token."+encoded]);state.logSocket=socket;
    socket.addEventListener("open",function(){el("log-stream-state").textContent="LIVE";});
    socket.addEventListener("close",function(){el("log-stream-state").textContent="DISCONNECTED";});
    socket.addEventListener("error",function(){el("log-stream-state").textContent="STREAM ERROR";});
    socket.addEventListener("message",function(event){if(state.logsPaused)return;try{state.logs.unshift(JSON.parse(event.data));if(state.logs.length>2000)state.logs.length=2000;renderSystemLogs();}catch(_error){}});
  }
  async function refreshAll(){
    var health=await api("GET","/health");
    await Promise.all([refreshProjects(),refreshSurface(),refreshProviders(),refreshLogs(),refreshUsage()]);
    setConnected(true);
    openLogStream();
    notice("Connected to FrameOS "+(health.data.version||"daemon")+".");
  }
  async function planAgent(){
    await ensureProject();
    var provider=state.providers[Number(el("agent-provider").value)];
    if(!provider)throw new Error("Configure FRAMEOS_OPENAI_API_KEY and restart the daemon first.");
    var request=el("agent-request").value.trim();if(!request)throw new Error("Enter an edit request.");
    var costBudget=Number(el("agent-cost-budget").value);
    var session=(await api("POST","/api/v1/agents/sessions",{projectId:state.project.projectId,provider:provider.kind,model:provider.model,approvalMode:el("agent-approval").value,budgets:{maxPreviewCycles:3,maxOperationsPerTransaction:200,...(Number.isFinite(costBudget)?{maxProviderCostUsd:costBudget}:{})}})).data;
    var run=(await api("POST","/api/v1/agents/runs",{sessionId:session.id,request:request})).data;state.currentRun=run;state.approvalId=null;el("agent-result").textContent=JSON.stringify({session:session,run:run},null,2);el("agent-execute").disabled=run.state!=="planned";el("agent-approve").disabled=true;el("agent-reject").disabled=true;await refreshUsage();return run;
  }
  async function executeAgent(){
    if(!state.currentRun)throw new Error("Create a plan first.");
    var operations=JSON.parse(el("agent-operations").value).map(function(operation){return operation.operationId==="auto"?{...operation,operationId:id()}:operation;});
    var result=(await api("POST","/api/v1/agents/runs/"+state.currentRun.id+"/execute",{operations:operations})).data;state.currentRun=result.run;state.approvalId=result.approval&&result.approval.id;el("agent-result").textContent=JSON.stringify(result,null,2);el("agent-approve").disabled=!state.approvalId;el("agent-reject").disabled=!state.approvalId;await Promise.all([refreshProjects(),refreshUsage()]);return result;
  }
  async function decideAgent(decision){if(!state.approvalId)throw new Error("No approval is pending.");var result=(await api("POST","/api/v1/approvals/"+state.approvalId+"/decision",{decision:decision,decidedBy:"frameos-admin",note:"Decision from the FrameOS control room"})).data;state.currentRun=result.run;state.approvalId=null;el("agent-result").textContent=JSON.stringify(result,null,2);el("agent-approve").disabled=true;el("agent-reject").disabled=true;await Promise.all([refreshProjects(),refreshUsage()]);return result;}
  async function ensureProject(){
    if(state.project) return state.project;
    var project=await api("POST","/api/v1/projects",{name:"Feature Lab "+new Date().toLocaleTimeString()});
    await refreshProjects();
    await loadProject(project.data.projectId);
    return state.project;
  }
  async function transact(operations,mode,keySuffix){
    await ensureProject();
    var result=await api("POST","/api/v1/transactions",{projectId:state.project.projectId,baseRevision:state.project.revision,idempotencyKey:"feature-lab-"+keySuffix+"-"+id(),mode:mode||"commit",operations:operations});
    if((mode||"commit")==="commit") await loadProject(state.project.projectId);
    await refreshProjects();
    return result.data;
  }
  async function pollJob(jobId,maxAttempts){
    for(var attempt=0;attempt<(maxAttempts||80);attempt+=1){
      var job=(await api("GET","/api/v1/jobs/"+encodeURIComponent(jobId))).data;
      if(["completed","failed","cancelled"].indexOf(job.status)>=0) return job;
      await new Promise(function(resolve){setTimeout(resolve,150);});
    }
    return (await api("GET","/api/v1/jobs/"+encodeURIComponent(jobId))).data;
  }
  var tests={
    async health(){
      var health=await api("GET","/health");
      await refreshSurface();
      return "Daemon "+health.data.status+"; "+state.catalog.operations.length+" operations; "+state.catalog.capabilities.length+" capabilities.";
    },
    async metadata(){
      await ensureProject();
      var result=await transact([{operationId:id(),type:"project.metadata.set",preconditions:[],arguments:{values:{featureLabLastCommit:now()}}}],"commit","metadata");
      return "Committed "+result.changes.length+" change; revision "+result.resultingRevision+".";
    },
    async "marker-title"(){
      await ensureProject();
      var sequence=selectedSequence();
      var track=selectedVideoTrack();
      var titleId=id();
      var result=await transact([
        {operationId:id(),type:"marker.add",preconditions:[],arguments:{sequenceId:sequence.id,marker:{id:id(),name:"Feature Lab marker",range:{start:time(0),duration:time(30)},color:"acid",metadata:{source:"feature-lab"}}}},
        {operationId:id(),type:"title.add",preconditions:[],arguments:{sequenceId:sequence.id,trackId:track.id,title:{id:titleId,name:"Feature Lab title",type:"title",text:"FrameOS feature lab",timelineRange:{start:time(0),duration:time(90)},enabled:true,locked:false,metadata:{source:"feature-lab"},style:{placement:"center"},transform:{positionX:0,positionY:0,anchorX:.5,anchorY:.5,scaleX:1,scaleY:1,rotation:0,opacity:1,cropTop:0,cropRight:0,cropBottom:0,cropLeft:0,blendMode:"normal"},effects:[]}}}
      ],"commit","marker-title");
      return "Added marker + title item "+titleId.slice(0,8)+"; revision "+result.resultingRevision+".";
    },
    async captions(){
      await ensureProject();
      var sequence=selectedSequence();
      var imported=await api("POST","/api/v1/imports/captions",{projectId:state.project.projectId,sequenceId:sequence.id,baseRevision:state.project.revision,idempotencyKey:"feature-lab-captions-"+id(),mode:"commit",format:"vtt",content:"WEBVTT\n\n00:00.000 --> 00:01.250\nFrameOS caption test\n",name:"Feature Lab Captions",language:"en"});
      await loadProject(state.project.projectId);
      var exported=await api("POST","/api/v1/exports/captions",{projectId:state.project.projectId,sequenceId:sequence.id,captionTrackId:imported.data.captionTrackId,format:"srt",revision:state.project.revision});
      return "Imported "+imported.data.cueCount+" cue; exported "+exported.data.content.split("\\n").length+" SRT lines.";
    },
    async semantic(){
      await ensureProject();
      var sequence=selectedSequence();
      var track=selectedVideoTrack();
      var silence=await api("POST","/api/v1/semantic/remove-silences/plan",{projectId:state.project.projectId,baseRevision:state.project.revision,trackIds:[track.id]});
      var vertical=await api("POST","/api/v1/semantic/make-vertical/plan",{projectId:state.project.projectId,baseRevision:state.project.revision,sequenceId:sequence.id,outputWidth:1080,outputHeight:1920,fit:"cover",maximumOperations:200});
      return "Silence plan "+silence.data.operations.length+" ops; vertical plan "+vertical.data.operations.length+" ops; project revision unchanged at "+state.project.revision+".";
    },
    async otio(){
      await ensureProject();
      var exported=await api("POST","/api/v1/exports/otio",{projectId:state.project.projectId});
      var imported=await api("POST","/api/v1/imports/otio",{document:exported.data.document,projectName:"Feature Lab OTIO Copy"});
      await refreshProjects();
      return "Export report "+exported.data.report.direction+"; imported copy "+imported.data.project.projectId.slice(0,8)+".";
    },
    async "render-gate"(){
      await ensureProject();
      var queued=await api("POST","/api/v1/renders",{projectId:state.project.projectId,outputName:"feature-lab.mp4"});
      var job=await pollJob(queued.data.id,50);
      await refreshSurface();
      if(job.status==="failed"&&job.error&&job.error.code==="CAPABILITY_UNAVAILABLE"){var gate=new Error("Capability gate observed: "+job.error.message);gate.gate=true;throw gate;}
      return "Render job "+job.status+"; job "+job.id.slice(0,8)+".";
    },
    async "agent-gate"(){
      await ensureProject();
      var session=await api("POST","/api/v1/agents/sessions",{projectId:state.project.projectId,provider:"local",model:"feature-lab-local",approvalMode:"propose",budgets:{maxPreviewCycles:1,maxOperationsPerTransaction:10}});
      try{
        var run=await api("POST","/api/v1/agents/runs",{sessionId:session.data.id,request:"Set a project metadata note."});
        return "Agent run planned: "+run.data.id.slice(0,8)+" state "+run.data.state+".";
      }catch(error){
        var gate=new Error("Agent provider gate observed: "+envelopeText(error));
        gate.gate=true;
        throw gate;
      }
    }
  };
  async function runTest(name){
    setCard(name,"");
    log("Running "+name+"...","service");
    try{
      var message=await tests[name]();
      setCard(name,"pass");
      log(name+" passed","pass",message);
    }catch(error){
      if(error.gate){
        setCard(name,"gate");
        log(name+" gated as expected","gate",envelopeText(error));
      }else{
        setCard(name,"fail");
        log(name+" failed","fail",envelopeText(error));
      }
    }
  }
  async function importAsset(){
    await ensureProject();
    var selectedFile=el("asset-file").files&&el("asset-file").files[0];
    var kind=el("asset-kind").value;
    if(selectedFile){
      var query="?projectId="+encodeURIComponent(state.project.projectId)+"&baseRevision="+encodeURIComponent(state.project.revision)+(kind?"&kind="+encodeURIComponent(kind):"");
      var uploaded=await uploadApi("/api/v1/assets/uploads"+query,selectedFile);
      state.selectedAssetId=uploaded.data.asset.id;
      await loadProject(state.project.projectId);
      await refreshSurface();
      el("asset-result").textContent="Imported "+uploaded.data.asset.name+" as managed asset "+state.selectedAssetId.slice(0,8)+"; warnings "+uploaded.data.warnings.length+".";
      log("Media file imported","pass",uploaded.data.asset.name);
      el("asset-file").value="";el("asset-file-label").textContent="No file selected";
      return;
    }
    var uri=el("asset-uri").value.trim();
    if(!uri) throw new Error("Choose a media file or enter an absolute path.");
    var body={projectId:state.project.projectId,baseRevision:state.project.revision,idempotencyKey:"feature-lab-import-"+id(),uri:uri,managed:el("asset-managed").checked};
    if(kind) body.kind=kind;
    var imported=await api("POST","/api/v1/assets/imports",body);
    state.selectedAssetId=imported.data.asset.id;
    await loadProject(state.project.projectId);
    el("asset-result").textContent="Imported "+imported.data.asset.name+" as "+state.selectedAssetId.slice(0,8)+"; warnings "+imported.data.warnings.length+".";
  }
  async function analyzeAsset(){
    await ensureProject();
    var assetId=state.selectedAssetId||Object.keys(state.project.assets)[0];
    if(!assetId) throw new Error("Import or select an asset first.");
    var started=await api("POST","/api/v1/projects/"+state.project.projectId+"/assets/"+assetId+"/analysis",{projectId:state.project.projectId,assetId:assetId,analyzers:["frameos.asset-metadata"],parameters:{},force:false});
    var job=await pollJob(started.data.id,80);
    await loadProject(state.project.projectId);
    await refreshSurface();
    el("asset-result").textContent="Analysis job "+job.status+"; "+(job.error?job.error.message:"metadata indexed")+".";
  }
  async function searchAnalysis(){
    await ensureProject();
    var query=prompt("Search analysis text", "feature lab")||"";
    if(!query.trim()) return;
    var searched=await api("POST","/api/v1/assets/search",{projectId:state.project.projectId,query:query,mode:"lexical",limit:20});
    el("asset-result").textContent="Search returned "+searched.data.length+" result(s) using "+searched.meta.searchBackend+".";
    log("Analysis search","pass",searched.data.length+" result(s) for '"+query+"'");
  }
  el("connect").addEventListener("click",async function(){
    state.baseUrl=el("base-url").value.replace(/\/$/,"");
    state.token=el("token").value.trim();
    sessionStorage.setItem("frameos-url",state.baseUrl);
    try{await refreshAll();}catch(error){setConnected(false);notice(envelopeText(error),true);}
  });
  el("refresh-projects").addEventListener("click",async function(){try{await refreshAll();log("Refreshed daemon surface","pass");}catch(error){log("Refresh failed","fail",envelopeText(error));}});
  el("create-project").addEventListener("submit",async function(event){
    event.preventDefault();
    var name=el("project-name").value.trim();
    if(!name) return;
    try{var created=await api("POST","/api/v1/projects",{name:name});el("project-name").value="";await refreshProjects();await loadProject(created.data.projectId);log("Project created","pass",name);}catch(error){log("Project create failed","fail",envelopeText(error));}
  });
  document.querySelectorAll("[data-test]").forEach(function(button){button.addEventListener("click",function(){runTest(button.dataset.test);});});
  document.querySelectorAll("[data-tab]").forEach(function(button){button.addEventListener("click",function(){state.tab=button.dataset.tab;document.querySelectorAll("[data-tab]").forEach(function(peer){peer.setAttribute("aria-selected",String(peer===button));});renderCatalog();});});
  document.querySelectorAll("[data-mode]").forEach(function(button){button.addEventListener("click",function(){state.mode=button.dataset.mode;document.querySelectorAll("[data-mode]").forEach(function(peer){peer.classList.toggle("active",peer===button);});});});
  el("catalog-search").addEventListener("input",renderCatalog);
  el("clear-log").addEventListener("click",function(){el("run-log").innerHTML='<li class="muted">No tests run yet.</li>';});
  el("load-selected-json").addEventListener("click",function(){el("project-json").textContent=state.project?JSON.stringify(state.project,null,2):'{\\n  \"status\": \"waiting_for_project\"\\n}';});
  el("execute").addEventListener("click",async function(){
    try{
      await ensureProject();
      var operations=JSON.parse(el("transaction-json").value).map(function(operation){return operation.operationId==="auto"?{...operation,operationId:id()}:operation;});
      var result=await transact(operations,state.mode,"manual");
      el("project-json").textContent=JSON.stringify(result.project,null,2);
      log("Manual transaction "+state.mode,"pass",result.changes.length+" changes; revision "+result.resultingRevision);
    }catch(error){log("Manual transaction failed","fail",envelopeText(error));}
  });
  el("import-asset").addEventListener("click",function(){importAsset().catch(function(error){el("asset-result").textContent=envelopeText(error);log("Asset import failed","fail",envelopeText(error));});});
  el("asset-file").addEventListener("change",function(){var file=el("asset-file").files&&el("asset-file").files[0];el("asset-file-label").textContent=file?file.name+" · "+formatNumber(file.size)+" bytes":"No file selected";if(file)el("asset-uri").value="";});
  el("analyze-asset").addEventListener("click",function(){analyzeAsset().catch(function(error){el("asset-result").textContent=envelopeText(error);log("Asset analysis failed","fail",envelopeText(error));});});
  el("search-analysis").addEventListener("click",function(){searchAnalysis().catch(function(error){el("asset-result").textContent=envelopeText(error);log("Analysis search failed","fail",envelopeText(error));});});
  el("agent-plan").addEventListener("click",function(){el("agent-plan").disabled=true;el("agent-result").textContent="Planning against project state and capabilities...";planAgent().then(function(run){log("Agent plan completed","pass",run.id+" · "+run.state);}).catch(function(error){el("agent-result").textContent=envelopeText(error);log("Agent plan failed","fail",envelopeText(error));}).finally(function(){el("agent-plan").disabled=false;});});
  el("agent-execute").addEventListener("click",function(){el("agent-execute").disabled=true;executeAgent().then(function(result){log("Agent preview completed","pass",result.run.state);}).catch(function(error){el("agent-result").textContent=envelopeText(error);log("Agent execute failed","fail",envelopeText(error));el("agent-execute").disabled=false;});});
  el("agent-approve").addEventListener("click",function(){decideAgent("approve").then(function(result){log("Agent draft approved","pass","revision "+result.run.resultingRevision);}).catch(function(error){log("Approval failed","fail",envelopeText(error));});});
  el("agent-reject").addEventListener("click",function(){decideAgent("reject").then(function(){log("Agent draft rejected","gate");}).catch(function(error){log("Rejection failed","fail",envelopeText(error));});});
  el("refresh-usage").addEventListener("click",function(){refreshUsage().catch(function(error){log("Usage refresh failed","fail",envelopeText(error));});});
  el("api-send").addEventListener("click",function(){var method=el("api-method").value;var path=el("api-path").value.trim();if(!path.startsWith("/")){el("api-result").textContent="Path must start with /.";return;}var raw=el("api-body").value.trim();var body;try{body=method==="GET"||raw===""?undefined:JSON.parse(raw);}catch(error){el("api-result").textContent="Invalid JSON: "+envelopeText(error);return;}el("api-send").disabled=true;el("api-result").textContent="Request running...";api(method,path,body).then(function(result){el("api-result").textContent=JSON.stringify(result,null,2);log("Raw API request completed","pass",method+" "+path);refreshSurface().catch(function(){});}).catch(function(error){el("api-result").textContent=envelopeText(error);log("Raw API request failed","fail",method+" "+path+" · "+envelopeText(error));}).finally(function(){el("api-send").disabled=false;});});
  el("log-level").addEventListener("change",renderSystemLogs);
  el("log-search").addEventListener("input",renderSystemLogs);
  el("log-pause").addEventListener("click",function(){state.logsPaused=!state.logsPaused;el("log-pause").textContent=state.logsPaused?"Resume":"Pause";el("log-stream-state").textContent=state.logsPaused?"PAUSED":"LIVE";if(!state.logsPaused)refreshLogs().catch(function(){});});
  el("log-clear").addEventListener("click",function(){state.logs=[];renderSystemLogs();});
  el("base-url").value=sessionStorage.getItem("frameos-url")||location.origin;
})();
`;

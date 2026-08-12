export const inspectorHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FrameOS / Control Surface</title>
  <link rel="stylesheet" href="/inspector/app.css">
</head>
<body>
  <div class="scanline" aria-hidden="true"></div>
  <header>
    <div class="wordmark"><span>FRAME</span><b>/</b><span>OS</span></div>
    <p>Agent-native editing control surface</p>
    <div id="connection-state" class="signal offline"><i></i><span>OFFLINE</span></div>
  </header>
  <main>
    <section class="connect panel" aria-labelledby="connect-title">
      <div class="panel-title"><span>00</span><h1 id="connect-title">Daemon link</h1></div>
      <label>API origin<input id="base-url" value="http://127.0.0.1:31415" spellcheck="false"></label>
      <label>Bearer token<input id="token" type="password" autocomplete="off" placeholder="Paste .frameos-data/auth-token"></label>
      <button id="connect">Establish link <span>→</span></button>
      <output id="notice" aria-live="polite">Credentials remain in this browser tab.</output>
    </section>

    <section class="workspace" aria-label="FrameOS inspector">
      <aside class="panel projects">
        <div class="panel-title"><span>01</span><h2>Projects</h2><button id="refresh-projects" class="icon" title="Refresh">↻</button></div>
        <form id="create-project"><input id="project-name" placeholder="New project name" maxlength="1024"><button>Create</button></form>
        <nav id="project-list" aria-label="Projects"><p class="empty">Connect to enumerate projects.</p></nav>
      </aside>

      <section class="panel state">
        <div class="panel-title"><span>02</span><h2>Canonical state</h2><div id="revision" class="badge">REV —</div></div>
        <div class="timeline-ruler" aria-hidden="true"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span></div>
        <pre id="project-json" tabindex="0">{
  "status": "waiting_for_project"
}</pre>
      </section>

      <aside class="panel catalog">
        <div class="panel-title"><span>03</span><h2>Machine surface</h2></div>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="true" data-tab="capabilities">Capabilities</button>
          <button role="tab" aria-selected="false" data-tab="operations">Operations</button>
        </div>
        <input id="catalog-search" type="search" placeholder="Filter catalog" aria-label="Filter catalog">
        <div id="catalog-list" class="catalog-list"><p class="empty">No capability data.</p></div>
      </aside>

      <section class="panel transaction">
        <div class="panel-title"><span>04</span><h2>Transaction console</h2><div class="mode-switch" role="group" aria-label="Transaction mode"><button data-mode="validate" class="active">Validate</button><button data-mode="preview">Preview</button><button data-mode="commit">Commit</button></div></div>
        <textarea id="transaction-json" spellcheck="false" aria-label="Transaction operations JSON">[
  {
    "operationId": "replace-with-uuidv7",
    "type": "project.metadata.set",
    "preconditions": [],
    "arguments": { "values": { "note": "FrameOS inspector" } }
  }
]</textarea>
        <div class="transaction-actions"><button id="execute" disabled>Execute against current revision <span>⌁</span></button><output id="transaction-result">Select a project to begin.</output></div>
      </section>
    </section>
  </main>
  <script src="/inspector/app.js" defer></script>
</body>
</html>`;

export const inspectorCss = `
:root{--ink:#10120f;--paper:#e8e3d6;--acid:#d6ff3f;--red:#f04b38;--line:#77786f;--dim:#bdb8aa;--panel:#f3eee2;--mono:"Cascadia Mono","IBM Plex Mono",monospace;--display:"Bodoni MT","Didot",serif}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--ink);font-family:var(--mono);min-height:100vh}.scanline{position:fixed;inset:0;pointer-events:none;opacity:.08;z-index:5;background:repeating-linear-gradient(0deg,transparent 0 3px,#fff 4px)}
header{height:76px;padding:0 28px;color:var(--paper);display:flex;align-items:center;border-bottom:1px solid #3b3e36;gap:24px}header p{margin:0;color:#999d91;font-size:11px;letter-spacing:.16em;text-transform:uppercase}.wordmark{font-family:var(--display);font-size:29px;letter-spacing:-.06em}.wordmark b{color:var(--acid);font-family:var(--mono);padding:0 4px}.signal{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.18em}.signal i{display:block;width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 12px var(--red)}.signal.online i{background:var(--acid);box-shadow:0 0 12px var(--acid)}
main{padding:18px}.panel{background:var(--panel);border:1px solid #191b17;box-shadow:5px 5px 0 #000}.panel-title{height:45px;border-bottom:1px solid var(--ink);display:flex;align-items:center;gap:12px;padding:0 14px}.panel-title>span{font-size:10px;background:var(--ink);color:var(--acid);padding:3px 6px}.panel-title h1,.panel-title h2{font-family:var(--display);font-size:20px;font-weight:600;margin:0;letter-spacing:-.02em}.panel-title .icon{margin-left:auto}
.connect{display:grid;grid-template-columns:210px minmax(180px,1fr) minmax(220px,1.4fr) 180px 1fr;align-items:end;margin-bottom:18px}.connect .panel-title{height:72px;border-bottom:0;border-right:1px solid var(--ink)}label{font-size:9px;text-transform:uppercase;letter-spacing:.13em;padding:10px 12px}input,textarea{display:block;width:100%;font:12px var(--mono);background:transparent;color:var(--ink);border:0;border-bottom:1px solid var(--line);padding:10px 2px 7px;outline:none}input:focus,textarea:focus{border-color:var(--ink);box-shadow:0 2px 0 var(--acid)}button{font:600 10px var(--mono);letter-spacing:.08em;text-transform:uppercase;background:var(--ink);color:var(--paper);border:0;padding:11px 13px;cursor:pointer}button:hover,button:focus-visible{background:#30332b;color:var(--acid);outline:2px solid var(--acid);outline-offset:-2px}button:disabled{opacity:.35;cursor:not-allowed}.connect>button{margin:0 12px 12px}.connect output{font-size:9px;color:#5d6057;padding:0 14px 14px}
.workspace{display:grid;grid-template-columns:minmax(210px,1fr) minmax(400px,2.7fr) minmax(260px,1.35fr);grid-template-rows:minmax(430px,58vh) minmax(270px,35vh);gap:18px}.projects{grid-row:1/3}.state{min-width:0}.catalog{grid-row:1/3}.transaction{grid-column:2}.projects form{display:flex;padding:12px;border-bottom:1px solid var(--dim)}.projects form input{margin-right:7px}.projects nav{padding:8px;overflow:auto;max-height:calc(100% - 111px)}.project{width:100%;text-align:left;background:transparent;color:var(--ink);border-bottom:1px solid var(--dim);padding:14px 9px}.project:hover,.project.active{background:var(--acid);color:var(--ink);outline:0}.project small{display:block;color:#686b62;margin-top:6px}.empty{font-size:10px;color:#777b70;padding:10px;line-height:1.6}.badge{margin-left:auto;border:1px solid var(--ink);font-size:9px;padding:4px 7px}.timeline-ruler{height:28px;display:flex;justify-content:space-between;padding:8px 12px 0;color:#70736a;font-size:8px;border-bottom:1px dotted var(--line);background:repeating-linear-gradient(90deg,transparent 0 24px,#a8a69c 25px,transparent 26px)}pre{margin:0;padding:16px;height:calc(100% - 73px);overflow:auto;font:11px/1.58 var(--mono);tab-size:2;white-space:pre;color:#cbd0bf;background:#161814}
.tabs{display:flex;border-bottom:1px solid var(--ink)}.tabs button{flex:1;background:transparent;color:var(--ink);border-right:1px solid var(--ink)}.tabs button[aria-selected=true]{background:var(--acid)}#catalog-search{width:calc(100% - 24px);margin:7px 12px}.catalog-list{height:calc(100% - 125px);overflow:auto;padding:0 12px}.catalog-item{padding:11px 0;border-bottom:1px solid var(--dim)}.catalog-item b{display:block;font-size:10px;overflow-wrap:anywhere}.catalog-item p{font:9px/1.5 var(--mono);margin:5px 0;color:#65685e}.tag{display:inline-block;font-size:8px;margin-right:5px;padding:3px 5px;border:1px solid var(--line)}.tag.yes{background:var(--acid);border-color:var(--ink)}.tag.no{background:#d7d1c4;color:#7c4c43}.transaction .panel-title{gap:12px}.mode-switch{display:flex;margin-left:auto}.mode-switch button{padding:7px 9px;background:transparent;color:var(--ink);border:1px solid var(--ink);margin-left:-1px}.mode-switch button.active{background:var(--ink);color:var(--acid)}textarea{height:145px;resize:vertical;padding:12px;background:#161814;color:#d7dccb;border:0}.transaction-actions{display:flex;align-items:center;gap:15px;padding:10px 12px}.transaction-actions output{font-size:9px;color:#5d6057;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:1050px){.connect{grid-template-columns:1fr 1fr}.connect .panel-title{grid-column:1/3;border-right:0;border-bottom:1px solid}.workspace{grid-template-columns:220px 1fr;grid-template-rows:430px 360px 280px}.projects{grid-row:1/3}.catalog{grid-row:3;grid-column:1/3}.transaction{grid-column:2}.catalog-list{height:190px}}@media(max-width:700px){header p{display:none}.connect,.workspace{display:block}.connect>*{margin-bottom:8px}.panel{margin-bottom:16px}.projects,.state,.catalog,.transaction{height:420px}.transaction{height:auto}.connect .panel-title{border-bottom:1px solid}.signal{font-size:0}}
@media(prefers-reduced-motion:no-preference){.panel{animation:arrive .35s both;transform-origin:top left}.workspace .panel:nth-child(2){animation-delay:.06s}.workspace .panel:nth-child(3){animation-delay:.12s}.workspace .panel:nth-child(4){animation-delay:.18s}@keyframes arrive{from{opacity:0;transform:translateY(8px) skewY(.3deg)}to{opacity:1;transform:none}}}
`;

export const inspectorJavaScript = `
(function(){
  "use strict";
  var state={baseUrl:"",token:"",project:null,tab:"capabilities",catalog:{capabilities:[],operations:[]},mode:"validate"};
  var el=function(id){return document.getElementById(id);};
  function notice(message,error){el("notice").textContent=message;el("notice").style.color=error?"#b42f22":"#5d6057";}
  async function api(method,path,body){var response=await fetch(state.baseUrl+path,{method:method,headers:{authorization:"Bearer "+state.token,accept:"application/json",...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});var envelope=await response.json();if(!response.ok||envelope.error){throw new Error((envelope.error&&envelope.error.code?envelope.error.code+": ":"")+(envelope.error?envelope.error.message:response.statusText));}return envelope.data;}
  function setConnected(value){var node=el("connection-state");node.classList.toggle("online",value);node.classList.toggle("offline",!value);node.querySelector("span").textContent=value?"LINKED":"OFFLINE";}
  function renderProjects(projects){var list=el("project-list");list.textContent="";if(!projects.length){list.innerHTML='<p class="empty">No project bundles found.</p>';return;}projects.forEach(function(project){var button=document.createElement("button");button.className="project"+(state.project&&state.project.projectId===project.projectId?" active":"");var title=document.createElement("b");title.textContent=project.settings.name;var info=document.createElement("small");info.textContent="REV "+project.revision+" · "+project.projectId.slice(0,8);button.append(title,info);button.addEventListener("click",function(){openProject(project.projectId);});list.append(button);});}
  function renderCatalog(){var query=el("catalog-search").value.toLowerCase();var list=el("catalog-list");list.textContent="";var items=state.catalog[state.tab].filter(function(item){return JSON.stringify(item).toLowerCase().includes(query);});items.slice(0,500).forEach(function(item){var box=document.createElement("article");box.className="catalog-item";var name=document.createElement("b");name.textContent=item.name||item.id;var description=document.createElement("p");description.textContent=item.description||"";var tag=document.createElement("span");tag.className="tag "+((item.available===true||item.maturity==="implemented"||item.maturity==="service")?"yes":"no");tag.textContent=item.available===true?"AVAILABLE":item.available===false?"GATED":String(item.maturity||item.kind||"").toUpperCase();box.append(name,description,tag);list.append(box);});if(!items.length){list.innerHTML='<p class="empty">No matching records.</p>';}}
  async function refresh(){try{var values=await Promise.all([api("GET","/api/v1/projects"),api("GET","/api/v1/capabilities"),api("GET","/api/v1/operations")]);renderProjects(values[0]);state.catalog.capabilities=values[1];state.catalog.operations=values[2];renderCatalog();setConnected(true);notice("Connected. Machine surface synchronized.");}catch(error){setConnected(false);notice(error.message,true);}}
  async function openProject(id){try{state.project=await api("GET","/api/v1/projects/"+encodeURIComponent(id));el("project-json").textContent=JSON.stringify(state.project,null,2);el("revision").textContent="REV "+state.project.revision;el("execute").disabled=false;renderProjects(await api("GET","/api/v1/projects"));}catch(error){notice(error.message,true);}}
  el("connect").addEventListener("click",function(){state.baseUrl=el("base-url").value.replace(/\/$/,"");state.token=el("token").value;sessionStorage.setItem("frameos-url",state.baseUrl);refresh();});
  el("refresh-projects").addEventListener("click",refresh);el("catalog-search").addEventListener("input",renderCatalog);
  document.querySelectorAll("[data-tab]").forEach(function(button){button.addEventListener("click",function(){state.tab=button.dataset.tab;document.querySelectorAll("[data-tab]").forEach(function(peer){peer.setAttribute("aria-selected",String(peer===button));});renderCatalog();});});
  document.querySelectorAll("[data-mode]").forEach(function(button){button.addEventListener("click",function(){state.mode=button.dataset.mode;document.querySelectorAll("[data-mode]").forEach(function(peer){peer.classList.toggle("active",peer===button);});});});
  el("create-project").addEventListener("submit",async function(event){event.preventDefault();var name=el("project-name").value.trim();if(!name)return;try{var project=await api("POST","/api/v1/projects",{name:name});el("project-name").value="";await refresh();await openProject(project.projectId);}catch(error){notice(error.message,true);}});
  el("execute").addEventListener("click",async function(){if(!state.project)return;try{var operations=JSON.parse(el("transaction-json").value).map(function(operation){return operation.operationId==="replace-with-uuidv7"?{...operation,operationId:crypto.randomUUID()}:operation;});var result=await api("POST","/api/v1/transactions",{projectId:state.project.projectId,baseRevision:state.project.revision,idempotencyKey:"inspector-"+crypto.randomUUID(),mode:state.mode,operations:operations});el("transaction-result").textContent=state.mode.toUpperCase()+" · "+result.changes.length+" changes · revision "+result.resultingRevision;if(state.mode==="commit")await openProject(state.project.projectId);}catch(error){el("transaction-result").textContent=error.message;}});
  el("base-url").value=sessionStorage.getItem("frameos-url")||location.origin;
})();
`;

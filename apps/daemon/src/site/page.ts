export const landingHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="FrameOS is an agent-native video editing operating system: deterministic timelines, advanced editing operations, previews, evaluation, and rendering behind one API.">
  <title>FrameOS — The timeline is now an API</title>
  <link rel="stylesheet" href="/site/app.css">
</head>
<body>
  <div class="noise" aria-hidden="true"></div>
  <header class="nav">
    <a class="brand" href="/" aria-label="FrameOS home"><span>FRAME</span><i>/</i><span>OS</span></a>
    <nav aria-label="Primary"><a href="#system">System</a><a href="#services">Services</a><a href="#access">Early access</a></nav>
    <a class="console-link" href="/inspector">Open control room <span>↗</span></a>
  </header>

  <main>
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow"><span></span> Agent-native media infrastructure / v0.1</p>
        <h1>The timeline<br>is now <em>an API.</em></h1>
        <p class="lede">FrameOS gives software agents precise, inspectable control over a professional video-editing engine—from a one-frame trim to a complete multi-track production.</p>
        <div class="hero-actions"><a class="primary" href="#access">Join the first cohort</a><a class="text-link" href="/inspector">Test the live API surface →</a></div>
      </div>
      <div class="hero-machine" aria-label="FrameOS transaction visualization">
        <div class="machine-top"><span>REVISION / 0017</span><span class="live">● DETERMINISTIC</span></div>
        <div class="timeline">
          <div class="ruler"><i>00:00</i><i>00:04</i><i>00:08</i><i>00:12</i></div>
          <div class="track"><b>V1</b><span class="clip a">INTERVIEW_A</span><span class="clip b">B–ROLL_07</span><span class="clip c">TITLE</span></div>
          <div class="track"><b>V2</b><span class="clip d">MASK / TRACK</span><span class="gap"></span></div>
          <div class="track"><b>A1</b><span class="clip e">DIALOGUE · NORMALIZED</span></div>
          <div class="playhead"></div>
        </div>
        <div class="transaction-card">
          <span>TRANSACTION.COMMIT</span>
          <code>{ "operations": 42, "atomic": true }</code>
          <strong>FRAME ACCURATE <i>✓</i></strong>
        </div>
      </div>
      <div class="scroll-note">SCROLL TO INSPECT <span>↓</span></div>
    </section>

    <section class="manifesto" id="system">
      <p class="section-index">01 / THE SYSTEM</p>
      <div><h2>Not another editor.<br><em>An editing substrate.</em></h2><p>Every asset, track, clip, effect, keyframe, caption, and render is exposed through a typed contract. Agents work on draft revisions, validate their intent, inspect previews, and commit only when policy permits.</p></div>
      <div class="principles">
        <article><b>01</b><h3>Lossless state</h3><p>FrameOS JSON is canonical. Rational time and immutable revisions make every edit reproducible.</p></article>
        <article><b>02</b><h3>Agent-safe control</h3><p>Atomic transactions, capability gates, budgets, approvals, and rollback surround every action.</p></article>
        <article><b>03</b><h3>Engine depth</h3><p>MLT and FFmpeg power real editorial, audio, compositing, analysis, preview, and export workflows.</p></article>
      </div>
    </section>

    <section class="services" id="services">
      <div class="services-head"><p class="section-index">02 / WHAT WE OFFER</p><h2>One control plane.<br>Every frame.</h2></div>
      <div class="service-list">
        <article><span>EDIT</span><h3>Deterministic editing API</h3><p>Typed low-level operations for tracks, clips, transitions, effects, transforms, color, audio, titles, captions, masks, multicam, and render profiles.</p><i>100+ executable operations</i></article>
        <article><span>THINK</span><h3>Agent planning & verification</h3><p>Connect OpenAI-compatible or external agents. Plan against live capabilities, preview uncommitted changes, evaluate, revise, and approve.</p><i>Provider-neutral orchestration</i></article>
        <article><span>SEE</span><h3>Media intelligence</h3><p>Probe assets, transcribe dialogue, find silence, detect scenes and beats, search analysis, and compile semantic requests into ordinary transactions.</p><i>Reproducible analysis artifacts</i></article>
        <article><span>SHIP</span><h3>Preview & rendering workers</h3><p>Isolated native workers produce frames, regions, contact sheets, waveforms, proxies, thumbnails, and final renders without taking down the daemon.</p><i>Crash-isolated execution</i></article>
      </div>
    </section>

    <section class="flow">
      <p class="section-index">03 / THE LOOP</p>
      <div class="flow-line"><span>01 <b>Inspect</b></span><i>→</i><span>02 <b>Plan</b></span><i>→</i><span>03 <b>Preview</b></span><i>→</i><span>04 <b>Evaluate</b></span><i>→</i><span>05 <b>Commit</b></span></div>
      <p>Humans, SDKs, MCP clients, and built-in agents all manipulate the same project document. No hidden timeline. No mystery state.</p>
    </section>

    <section class="access" id="access">
      <div><p class="section-index">04 / EARLY ACCESS</p><h2>Help build the<br>programmable edit suite.</h2><p>We are enrolling the first developers, creative automation teams, and media infrastructure builders. The list is local-only for this preview; integrations come next.</p></div>
      <form id="early-access-form">
        <label for="early-email">WORK EMAIL</label>
        <div><input id="early-email" name="email" type="email" autocomplete="email" placeholder="you@studio.com" required maxlength="320"><button>Enroll free <span>→</span></button></div>
        <label class="consent"><input type="checkbox" required> I want product updates and early testing invitations.</label>
        <output id="early-access-result" aria-live="polite">No payment. No spam. Unsubscribe whenever this becomes real.</output>
      </form>
    </section>
  </main>

  <footer><a class="brand" href="/"><span>FRAME</span><i>/</i><span>OS</span></a><p>Agent-native video infrastructure.<br>Built frame by frame.</p><div><a href="/inspector">Control room</a><a href="/health">System health</a><a href="https://github.com/">GitHub</a></div><small>© 2026 FRAMEOS / PRE-ALPHA</small></footer>
  <script src="/site/app.js" defer></script>
</body>
</html>`;

export const landingCss = String.raw`
:root{--black:#0b0d0c;--ink:#121512;--bone:#e9e3d6;--dim:#a5a397;--line:#343732;--orange:#ff5b22;--mint:#b7ffca;--mono:"Cascadia Code","IBM Plex Mono","SFMono-Regular",monospace;--serif:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,serif}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--black)}body{margin:0;background:var(--black);color:var(--bone);font-family:var(--mono);overflow-x:hidden}a{color:inherit;text-decoration:none}.noise{position:fixed;z-index:20;pointer-events:none;inset:0;opacity:.055;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.8'/%3E%3C/svg%3E")}.nav{height:78px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 4vw;border-bottom:1px solid var(--line);position:relative;z-index:10}.brand{font-family:var(--serif);font-size:24px;letter-spacing:-.08em;width:max-content}.brand i{font:normal 17px var(--mono);color:var(--orange);margin:0 6px}.nav nav{display:flex;gap:34px}.nav nav a,.console-link{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:var(--dim);transition:.2s}.nav nav a:hover,.console-link:hover{color:var(--bone)}.console-link{justify-self:end;border:1px solid var(--line);padding:11px 14px}.console-link span{color:var(--orange)}.hero{min-height:calc(100vh - 78px);padding:8vh 4vw 5vh;display:grid;grid-template-columns:1.08fr .92fr;gap:7vw;align-items:center;position:relative;background:radial-gradient(circle at 74% 42%,rgba(255,91,34,.08),transparent 28%),linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:auto,48px 48px,48px 48px}.eyebrow,.section-index{font-size:10px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}.eyebrow span{display:inline-block;width:26px;height:1px;background:var(--orange);vertical-align:middle;margin-right:9px}.hero h1,.manifesto h2,.services h2,.access h2{font-family:var(--serif);font-weight:400;letter-spacing:-.065em;margin:4vh 0 3vh;line-height:.88}.hero h1{font-size:clamp(66px,8.2vw,138px)}h1 em,h2 em{font-style:italic;color:var(--orange)}.lede{font:clamp(16px,1.35vw,22px)/1.55 var(--serif);color:#c4c0b5;max-width:610px}.hero-actions{display:flex;gap:28px;align-items:center;margin-top:40px}.primary{background:var(--orange);color:var(--black);padding:17px 21px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;box-shadow:7px 7px 0 #3b2117;transition:.2s}.primary:hover{transform:translate(-2px,-2px);box-shadow:10px 10px 0 #3b2117}.text-link{font-size:11px;color:var(--dim);border-bottom:1px solid var(--line);padding:10px 0}.hero-machine{border:1px solid #474a44;background:#111411;box-shadow:22px 22px 0 rgba(0,0,0,.5);transform:rotate(1.2deg);position:relative}.machine-top{height:46px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:9px;letter-spacing:.12em;color:var(--dim)}.machine-top .live{color:var(--mint)}.timeline{height:350px;position:relative;padding:44px 14px 18px;overflow:hidden}.ruler{position:absolute;left:44px;right:8px;top:14px;display:flex;justify-content:space-between;font-size:8px;color:#686b64}.track{height:65px;display:grid;grid-template-columns:30px repeat(12,1fr);gap:3px;margin-bottom:11px}.track>b{font-size:9px;color:#777b72;padding-top:9px}.clip{font-size:8px;letter-spacing:.05em;padding:10px 8px;color:#0b0d0c;overflow:hidden}.clip.a{grid-column:2/8;background:#b9b4a8}.clip.b{grid-column:8/13;background:var(--orange)}.clip.c{grid-column:13/14;background:var(--mint);writing-mode:vertical-lr}.clip.d{grid-column:4/10;background:#98aec0}.track .gap{grid-column:10/14;border:1px dashed #343832}.clip.e{grid-column:2/14;background:#d1c46e;height:38px}.playhead{position:absolute;top:28px;bottom:10px;left:58%;border-left:1px solid var(--orange);filter:drop-shadow(0 0 5px var(--orange))}.playhead:before{content:"";position:absolute;top:0;left:-5px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid var(--orange)}.transaction-card{position:absolute;right:-32px;bottom:-56px;width:74%;padding:17px;background:var(--bone);color:var(--black);box-shadow:10px 10px 0 var(--orange);transform:rotate(-2.2deg)}.transaction-card>span{font-size:9px;letter-spacing:.13em}.transaction-card code{display:block;margin:18px 0;font-size:10px;color:#55584f}.transaction-card strong{font-size:10px;letter-spacing:.1em}.transaction-card strong i{color:#16863b}.scroll-note{position:absolute;bottom:22px;left:4vw;font-size:8px;letter-spacing:.16em;color:#696d65}.scroll-note span{color:var(--orange);margin-left:9px}.manifesto,.services,.flow,.access{padding:110px 4vw;border-top:1px solid var(--line)}.manifesto{display:grid;grid-template-columns:.35fr 1fr;gap:6vw}.manifesto>div>p{max-width:760px;font:19px/1.6 var(--serif);color:#bdb9ae}.manifesto h2,.services h2,.access h2{font-size:clamp(52px,6vw,94px)}.principles{grid-column:2;display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);margin-top:45px}.principles article{padding:28px 24px 10px 0;border-right:1px solid var(--line);margin-right:24px}.principles article:last-child{border:0}.principles b,.service-list>article>span{font-size:9px;color:var(--orange)}.principles h3,.service-list h3{font:29px/1 var(--serif);letter-spacing:-.03em;margin:50px 0 15px}.principles p,.service-list p{font-size:11px;line-height:1.7;color:var(--dim)}.services{background:var(--bone);color:var(--black);display:grid;grid-template-columns:.7fr 1.3fr;gap:8vw}.services .section-index,.services p{color:#66675f}.service-list{border-top:1px solid #a9a69e}.service-list article{display:grid;grid-template-columns:65px 1fr 1.2fr .7fr;gap:25px;align-items:start;padding:30px 0;border-bottom:1px solid #aaa79e}.service-list h3{margin:0;font-size:25px}.service-list p{margin:0}.service-list i{font-size:9px;line-height:1.5;color:#6b6b63}.flow{text-align:center;overflow:hidden}.flow .section-index{text-align:left}.flow-line{display:flex;align-items:center;justify-content:space-between;margin:85px -2vw 65px}.flow-line span{font-size:9px;color:var(--orange);white-space:nowrap}.flow-line b{display:block;font:clamp(28px,3.5vw,60px)/1 var(--serif);color:var(--bone);margin-top:10px}.flow-line i{font:normal 34px var(--serif);color:#4b4e48}.flow>p:last-child{font:20px/1.6 var(--serif);color:var(--dim);max-width:720px;margin:auto}.access{display:grid;grid-template-columns:1fr 1fr;gap:10vw;background:var(--orange);color:var(--black)}.access .section-index,.access>div>p{color:#4f2618}.access>div>p:last-child{font:17px/1.6 var(--serif);max-width:610px}.access form{align-self:center;border-top:1px solid #7e3219;padding-top:25px}.access label{display:block;font-size:9px;letter-spacing:.13em;margin-bottom:8px}.access form>div{display:flex}.access input[type=email]{flex:1;background:transparent;border:0;border-bottom:2px solid var(--black);font:25px var(--serif);padding:14px 0;outline:0;min-width:0}.access input::placeholder{color:#77351e}.access button{background:var(--black);color:var(--bone);border:0;padding:0 20px;font:700 10px var(--mono);text-transform:uppercase;letter-spacing:.1em;cursor:pointer}.consent{margin-top:20px;display:flex!important;align-items:center;gap:8px;letter-spacing:0!important;text-transform:none}.consent input{accent-color:var(--black)}.access output{display:block;font-size:9px;margin-top:28px;color:#592717}footer{padding:65px 4vw;display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:40px;align-items:start;border-top:1px solid var(--line)}footer p,footer small,footer a{font-size:9px;line-height:1.7;color:var(--dim);text-transform:uppercase;letter-spacing:.11em}footer .brand{font-size:22px;color:var(--bone)}footer>div{display:flex;flex-direction:column;gap:7px}@media(max-width:900px){.nav{grid-template-columns:1fr auto}.nav nav{display:none}.hero,.manifesto,.services,.access{grid-template-columns:1fr}.hero{padding-top:50px;gap:90px}.hero-machine{margin:0 20px 50px 0}.manifesto .principles{grid-column:1}.service-list article{grid-template-columns:45px 1fr}.service-list p,.service-list i{grid-column:2}.flow-line{overflow:auto;gap:28px;justify-content:flex-start}.principles{grid-template-columns:1fr}.principles article{border-right:0;border-bottom:1px solid var(--line)}footer{grid-template-columns:1fr 1fr}}@media(max-width:560px){.nav{padding:0 18px}.console-link{font-size:0}.console-link span{font-size:14px}.hero,.manifesto,.services,.flow,.access{padding-left:20px;padding-right:20px}.hero h1{font-size:58px}.hero-actions{align-items:flex-start;flex-direction:column}.transaction-card{right:-10px;width:88%}.access form>div{display:block}.access button{padding:16px;width:100%;margin-top:10px}.principles{display:block}.service-list article{display:block}.service-list h3,.service-list p,.service-list i{display:block;margin-top:15px}footer{grid-template-columns:1fr}}@media(prefers-reduced-motion:no-preference){.hero-copy>*{animation:reveal .65s both}.hero-copy>*:nth-child(2){animation-delay:.08s}.hero-copy>*:nth-child(3){animation-delay:.16s}.hero-copy>*:nth-child(4){animation-delay:.24s}.hero-machine{animation:machine .8s .2s both}@keyframes reveal{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}@keyframes machine{from{opacity:0;transform:translateX(25px) rotate(3deg)}to{opacity:1;transform:rotate(1.2deg)}}}
`;

export const landingJavaScript = String.raw`
(function(){"use strict";var form=document.getElementById("early-access-form");var result=document.getElementById("early-access-result");form.addEventListener("submit",function(event){event.preventDefault();var email=document.getElementById("early-email").value.trim().toLowerCase();var entries=JSON.parse(localStorage.getItem("frameos-early-access")||"[]");if(entries.indexOf(email)<0)entries.push(email);localStorage.setItem("frameos-early-access",JSON.stringify(entries));result.textContent="ENROLLED LOCALLY — integrations will be connected in a later release.";result.style.fontWeight="700";form.reset();});})();
`;

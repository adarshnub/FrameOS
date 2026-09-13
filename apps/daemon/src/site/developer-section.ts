const developerMarkup = `<section class="developer-section" id="developer" aria-labelledby="developer-heading">
  <div class="developer-atmosphere" aria-hidden="true">
    <div class="developer-orbit"><i></i><i></i></div>
    <span></span><span></span><span></span><span></span><span></span>
  </div>
  <div class="developer-identity">
    <p class="eyebrow">THE PERSON BEHIND FRAMEOS</p>
    <h2 id="developer-heading">Adarsh <em>Viswam.</em></h2>
    <p class="developer-role">AI Solutions Architect</p>
  </div>
  <div class="developer-copy">
    <p class="muted">Have an idea for FrameOS?</p>
    <p class="muted">Share an improvement, suggest a new feature, or report a bug. I’d love to hear what would make your editing experience better.</p>
    <div class="developer-links">
      <a href="mailto:adarshmanjady@gmail.com">adarshmanjady@gmail.com <span aria-hidden="true">↗</span></a>
      <a href="https://www.linkedin.com/in/adarsh-viswam-95161016b/" target="_blank" rel="noopener noreferrer">LinkedIn <span aria-hidden="true">↗</span></a>
    </div>
  </div>
</section>`;

export function withDeveloperSection(html: string): string {
  return html.replace("</main>", `${developerMarkup}</main>`);
}

export const developerCss = String.raw`
.developer-section{
  position:relative;
  isolation:isolate;
  overflow:hidden;
  max-width:1240px;
  margin:auto;
  padding:64px 5%;
  display:grid;
  grid-template-columns:1fr 1.3fr;
  gap:60px;
  align-items:start;
  border-top:1px solid var(--line);
}
.developer-identity .eyebrow{margin-bottom:18px}
.developer-identity h2{font-size:clamp(30px,3vw,40px);margin-bottom:12px}
.developer-role{font-size:13px;color:var(--muted);margin-bottom:0}
.developer-copy{min-width:0;max-width:500px}
.developer-copy .muted{margin-bottom:14px}
.developer-copy .muted:first-child{color:var(--text);font-size:16px;margin-bottom:8px}
.developer-links{display:flex;flex-wrap:wrap;gap:12px 28px;margin-top:22px}
.developer-links a{display:inline-flex;align-items:center;gap:8px;max-width:100%;font-size:13px;color:var(--accent);text-decoration:underline;text-decoration-color:transparent;text-underline-offset:5px}
.developer-links a:hover{text-decoration-color:currentColor}
.developer-identity,.developer-copy{position:relative;z-index:1}
.developer-atmosphere{position:absolute;inset:0;z-index:0;pointer-events:none;perspective:800px}
.developer-orbit{position:absolute;right:-52px;bottom:-74px;width:220px;height:220px;transform-style:preserve-3d;animation:developer-orbit-drift 18s ease-in-out infinite}
.developer-orbit i{position:absolute;inset:0;border:1px solid var(--accent);opacity:.12;border-radius:50%;transform:rotateX(65deg) rotateY(-22deg)}
.developer-orbit i:last-child{inset:24px;opacity:.08;transform:rotateX(48deg) rotateY(30deg)}
.developer-atmosphere>span{position:absolute;width:3px;height:3px;border-radius:50%;background:var(--accent);opacity:.2;animation:developer-particle-drift 12s ease-in-out infinite}
.developer-atmosphere>span:nth-of-type(1){left:3%;top:30%;animation-delay:-3s}
.developer-atmosphere>span:nth-of-type(2){left:37%;top:17%;width:2px;height:2px;animation-delay:-7s}
.developer-atmosphere>span:nth-of-type(3){right:4%;top:22%;animation-delay:-5s}
.developer-atmosphere>span:nth-of-type(4){left:29%;bottom:12%;width:2px;height:2px;animation-delay:-9s}
.developer-atmosphere>span:nth-of-type(5){right:8%;bottom:28%;animation-delay:-1s}
@keyframes developer-orbit-drift{0%,100%{transform:translateY(0) rotateZ(-12deg)}50%{transform:translateY(-12px) rotateZ(6deg)}}
@keyframes developer-particle-drift{0%,100%{transform:translate3d(0,0,0);opacity:.15}50%{transform:translate3d(6px,-12px,0);opacity:.35}}
@media(max-width:760px){
  .developer-section{padding:48px 6%;grid-template-columns:1fr;gap:26px}
  .developer-links{flex-direction:column;align-items:flex-start;gap:16px}
  .developer-orbit{width:160px;height:160px;right:-70px;bottom:-58px}
}
@media(prefers-reduced-motion:reduce){.developer-orbit,.developer-atmosphere>span{animation:none}}
`;

// Kept for the existing stylesheet composition in the HTTP server.
export const developerLinkedinCss = "";

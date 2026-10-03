/* 原生离线知识导图：完整节点、分支聚焦、目录和原笔记导读。 */
"use strict";
Views.map = function () {
  Views.map.cleanup?.();
  const root = DB.chapters; if (!root) return;
  const byId = new Map(), parents = new Map(), counts = new Map(), all = [];
  function index(n, parent) {
    byId.set(n.id,n); if (parent) parents.set(n.id,parent); all.push(n);
    let count=1; for (const c of n.children || []) count+=index(c,n);
    counts.set(n.id,count); return count;
  }
  index(root);
  const branches=root.children || [], expanded=new Set([root.id]);
  let scope=root, selected=root, mode=window.matchMedia("(max-width: 700px)").matches ? "outline" : "map";
  let visible=[], positions=new Map(), bounds={width:1,height:1}, searchPage=0, searchHits=[], disposed=false, frame=0, observer, previousSize=null;
  const removers=[], cam={x:30,y:30,k:1}, pointers=new Map(); let gesture=null;
  const esc=escapeHtml;
  const pathOf=n => { const path=[n]; while (parents.has(path[0].id)) path.unshift(parents.get(path[0].id)); return path; };
  const sourceLabel=n => n.source?.line ? `chapter-01.md · 第 ${n.source.line}${n.source.endLine > n.source.line ? `–${n.source.endLine}` : ""} 行` : "chapter-01.md";
  const kindLabel=n => n.kind === "heading" ? "章节" : n.kind === "detail" ? "说明" : "知识点";
  const listen=(el,event,fn,options) => { el.addEventListener(event,fn,options); removers.push(() => el.removeEventListener(event,fn,options)); };
  $("#view").innerHTML=`
    <section class="mm-workspace" aria-label="马克思主义哲学知识导图">
      <header class="mm-heading"><div><span class="mm-eyebrow">读原笔记 · 理清知识脉络</span><h2>马克思主义哲学 <em>思维导图</em></h2></div><div class="mm-total">${all.length} 个节点 <span>·</span> ${all.reduce((a,n) => a+(n.diagrams?.length || 0),0)} 幅关系图</div></header>
      <div class="mm-controls"><div class="mm-search-field"><label class="mm-sr-only" for="mmSearch">搜索笔记</label><span aria-hidden="true">⌕</span><input id="mmSearch" type="search" placeholder="搜索知识点或原笔记，例如：人工智能" autocomplete="off"><label class="mm-sr-only" for="mmSearchMode">搜索范围</label><select id="mmSearchMode"><option value="full">全文</option><option value="title">节点</option></select></div><div class="mm-mode" role="group" aria-label="阅读方式"><button data-mode="map" aria-pressed="${mode === "map"}">导图画布</button><button data-mode="outline" aria-pressed="${mode === "outline"}">目录阅读</button></div></div>
      <div class="mm-search-results" id="mmResults" hidden></div>
      <nav class="mm-branches" aria-label="选择知识分支"><button data-scope="${esc(root.id)}" class="is-active" aria-current="true">全章概览 <span>${all.length}</span></button>${branches.map(n => `<button data-scope="${esc(n.id)}">${esc(n.title)} <span>${counts.get(n.id)}</span></button>`).join("")}</nav>
      <div class="mm-layout"><section class="mm-reader" aria-label="知识树"><div class="mm-reader-head"><div><strong id="mmScopeTitle"></strong><span id="mmVisibleCount"></span></div><div class="mm-expand-tools"><button data-command="one" title="把当前可见分支再展开一级">展开一层</button><button data-command="all">全部展开</button><button data-command="reset">收起细节</button></div></div><div class="mm-canvas" id="mmCanvas" ${mode === "map" ? "" : "hidden"}><svg id="mmSvg" role="tree" aria-label="知识点层级树，方向键导航，回车阅读，左右键折叠展开"><g id="mmGraph"></g></svg><div class="mm-zoom-tools" aria-label="画布缩放"><button data-command="zoomout" aria-label="缩小">−</button><output id="mmZoom">100%</output><button data-command="zoomin" aria-label="放大">＋</button><button class="mm-fit" data-command="fit">适应画布</button><button class="mm-fit" data-command="locate">定位选中</button></div><div class="mm-canvas-help">拖动画布 · 滚轮 / 双指缩放 · 点击节点阅读</div></div><div class="mm-outline" id="mmOutline" ${mode === "outline" ? "" : "hidden"} role="tree" aria-label="笔记层级目录"></div><div class="mm-legend"><span><i class="mm-tree-line"></i>连线表示笔记层级</span><span><i class="mm-relation-line"></i>哲学关系另列图示</span><span>标签全文保留，可逐层展开</span></div></section><aside class="mm-panel card" id="mmPanel" aria-label="节点笔记详情"></aside></div>
      <div class="mm-status mm-sr-only" role="status" aria-live="polite" id="mmStatus"></div>
    </section>`;
  const shell=$(".mm-workspace"), query=(selector,el=shell) => el.querySelector(selector), svg=query("#mmSvg"), graph=query("#mmGraph"), canvas=query("#mmCanvas"), outline=query("#mmOutline"), panel=query("#mmPanel"), searchInput=query("#mmSearch");
  const measure=document.createElement("canvas").getContext("2d"); measure.font="14px 'Microsoft YaHei', sans-serif";
  function wrapTitle(title,width) {
    const lines=[]; let line="";
    for (const ch of String(title)) { if (ch === "\n") { lines.push(line); line=""; continue; } if (line && measure.measureText(line+ch).width > width) { lines.push(line); line=""; } line+=ch; }
    if (line || !lines.length) lines.push(line); return lines;
  }
  function layout() {
    positions=new Map(); visible=[]; const edges=[], columns=[];
    function visit(n,depth) {
      const width=n.id === scope.id ? 232 : n.kind === "detail" ? 264 : 244, lines=wrapTitle(n.title,width-32), height=Math.max(52,lines.length*21+29);
      const p={n,depth,width,height,lines,x:0,y:0,size:0,children:[]}; positions.set(n.id,p); visible.push(n); columns[depth]=Math.max(columns[depth] || 0,width);
      if (expanded.has(n.id)) for (const c of n.children || []) { p.children.push(visit(c,depth+1)); edges.push([n,c]); }
      p.size=Math.max(height,p.children.reduce((s,c) => s+c.size,0)+Math.max(0,p.children.length-1)*22); return p;
    }
    const first=visit(scope,0), xs=[0]; columns.forEach((width,i) => xs[i+1]=xs[i]+width+82);
    function place(p,top) { p.x=xs[p.depth]; p.y=top+(p.size-p.height)/2; const childSize=p.children.reduce((s,c) => s+c.size,0)+Math.max(0,p.children.length-1)*22; let childTop=top+(p.size-childSize)/2; for (const c of p.children) { place(c,childTop); childTop+=c.size+22; } }
    place(first,0); bounds={width:xs[columns.length-1]+columns[columns.length-1]+42,height:first.size}; return edges;
  }
  function renderGraph() {
    const edges=layout();
    graph.innerHTML=edges.map(([a,b]) => { const p=positions.get(a.id), c=positions.get(b.id), x=p.x+p.width+35, y=p.y+p.height/2, cy=c.y+c.height/2, mid=(x+c.x)/2; return `<path class="mm-link" aria-hidden="true" d="M ${x} ${y} C ${mid} ${y},${mid} ${cy},${c.x} ${cy}"/>`; }).join("")+visible.map(n => {
      const p=positions.get(n.id);
      return `<g class="mm-node ${n.id === scope.id ? "mm-scope-node" : ""} ${n.kind === "heading" ? "mm-heading-node" : ""} ${selected.id === n.id ? "is-selected" : ""}" data-node="${esc(n.id)}" role="treeitem" tabindex="0" aria-level="${p.depth+1}" aria-selected="${selected.id === n.id}" ${n.children?.length ? `aria-expanded="${expanded.has(n.id)}"` : ""} aria-label="${esc(n.title)}${n.children?.length ? `，${n.children.length} 个下级知识点` : ""}" transform="translate(${p.x},${p.y})"><title>${esc(n.title)} · ${esc(sourceLabel(n))}</title><rect width="${p.width}" height="${p.height}" rx="10"/><text class="mm-node-label" x="16" y="25">${p.lines.map((line,i) => `<tspan x="16" ${i ? 'dy="21"' : ""}>${esc(line)}</tspan>`).join("")}</text>${n.children?.length ? `<text class="mm-node-count" x="16" y="${p.height-8}">${n.children.length} 个下级${expanded.has(n.id) ? " · 已展开" : " · 待展开"}</text><g class="mm-toggle" data-toggle="${esc(n.id)}" role="button" tabindex="0" aria-label="${expanded.has(n.id) ? "收起" : "展开"}${esc(n.title)}" transform="translate(${p.width+19},${p.height/2})"><rect x="-17" y="-17" width="34" height="34" rx="17"/><text x="0" y="5" text-anchor="middle">${expanded.has(n.id) ? "−" : "+"}</text></g>` : ""}</g>`;
    }).join("");
    query("#mmScopeTitle").textContent=scope.id === root.id ? "全章概览" : scope.title; query("#mmVisibleCount").textContent=`显示 ${visible.length} / ${counts.get(scope.id)} 个节点`;
  }
  function renderOutline() {
    function item(n,depth) { const children=n.children || [], open=expanded.has(n.id); return `<li role="none"><div class="mm-outline-row ${selected.id === n.id ? "is-selected" : ""}">${children.length ? `<button class="mm-outline-toggle" data-toggle="${esc(n.id)}" aria-label="${open ? "收起" : "展开"}${esc(n.title)}" aria-expanded="${open}">${open ? "−" : "+"}</button>` : '<span class="mm-outline-dot" aria-hidden="true">·</span>'}<button class="mm-outline-label" data-node="${esc(n.id)}" role="treeitem" aria-level="${depth+1}" aria-selected="${selected.id === n.id}" ${children.length ? `aria-expanded="${open}"` : ""}><span>${esc(n.title)}</span>${children.length ? `<small>${children.length} 个下级</small>` : ""}</button></div>${open && children.length ? `<ul role="group">${children.map(c => item(c,depth+1)).join("")}</ul>` : ""}</li>`; }
    outline.innerHTML=`<ul class="mm-outline-tree" role="none">${item(scope,0)}</ul>`;
  }
  function applyCam() { graph.setAttribute("transform",`translate(${cam.x},${cam.y}) scale(${cam.k})`); query("#mmZoom").textContent=`${Math.round(cam.k*100)}%`; }
  function renderTree() { renderGraph(); renderOutline(); applyCam(); }
  function fit() { if (canvas.hidden || !canvas.clientWidth || disposed) return; const width=canvas.clientWidth-56,height=canvas.clientHeight-112; cam.k=Math.min(1.12,Math.max(.08,Math.min(width/bounds.width,height/bounds.height))); cam.x=(canvas.clientWidth-bounds.width*cam.k)/2; cam.y=24+(height-bounds.height*cam.k)/2; applyCam(); }
  function centerNode(n,readable=true) { const p=positions.get(n.id); if (!p || canvas.hidden) return; if (readable) cam.k=Math.max(.85,Math.min(1.2,cam.k)); cam.x=canvas.clientWidth/2-(p.x+p.width/2)*cam.k; cam.y=(canvas.clientHeight-65)/2-(p.y+p.height/2)*cam.k; applyCam(); }
  function zoom(factor,x=canvas.clientWidth/2,y=canvas.clientHeight/2) { const k=Math.min(3,Math.max(.08,cam.k*factor)); cam.x=x-(x-cam.x)*k/cam.k; cam.y=y-(y-cam.y)*k/cam.k; cam.k=k; applyCam(); }
  function setScope(n,select=true) { scope=n; expanded.clear(); expanded.add(n.id); shell.querySelectorAll("[data-scope]").forEach(btn => { const active=btn.dataset.scope === n.id; btn.classList.toggle("is-active",active); if (active) btn.setAttribute("aria-current","true"); else btn.removeAttribute("aria-current"); }); if (select) selected=n; renderTree(); renderPanel(); fit(); }
  function selectNode(n) { selected=n; renderTree(); renderPanel(); panel.scrollTop=0; query("#mmStatus").textContent=`正在阅读：${n.title}`; }
  function focusTreeNode(n,toggleControl=false) {
    const container=mode === "map" ? graph : outline;
    const el=container.querySelector(`[data-${toggleControl ? "toggle" : "node"}="${n.id}"]`);
    el?.focus({preventScroll:true});
    if (mode === "outline") el?.scrollIntoView({block:"nearest"});
  }
  function scrollTreeNode(n) {
    if (mode === "outline") outline.querySelector(`[data-node="${n.id}"]`)?.scrollIntoView({block:"nearest"});
  }
  function reveal(n) {
    const path=pathOf(n), targetScope=path.length > 2 ? path[1] : root;
    if (scope.id !== targetScope.id) setScope(targetScope,false);
    for (const p of path) expanded.add(p.id);
    selectNode(n); centerNode(n); scrollTreeNode(n);
    query(".mm-layout").scrollIntoView({block:"start"});
    query("#mmStatus").textContent=`已定位：${path.map(p => p.title).join("，")}`;
  }
  function toggle(n) { if (!n.children?.length) return; expanded.has(n.id) ? expanded.delete(n.id) : expanded.add(n.id); renderTree(); }
  // 仅按节点具体主题关联练习，大类和根节点的题库不会被子节点自动继承。
  function practiceLinks(n) {
    if (n.id === root.id) return [{label:"期末真题 · 综合复习",questions:DB.ofBank("final-2024")}];
    const top=pathOf(n)[1], title=n.title, links=[], add=(label,qs) => { if (qs.length) links.push({label,questions:qs}); };
    if (top?.id === branches[0]?.id) { if (n.id === top.id || /组成部分|特性|科学性|人民性|实践性|发展性/.test(title)) add("考研 · 绪论",DB.ofKaoyanSection("绪论")); return links; }
    if (top?.id === branches[1]?.id && n.id === top.id) { add("本体论 · 课堂小测1",DB.ofBank("c1s1-q1")); add("物质与意识 · 课堂小测2",DB.ofBank("c1s1-q2")); return links; }
    if (top?.id === branches[2]?.id && n.id === top.id) { add("辩证法 · 课堂练习",DB.ofBank("c1s23")); add("考研 · 联系和发展",DB.ofKaoyanSection("联系和发展")); add("考研 · 三大规律",DB.ofKaoyanSection("三大规律")); return links; }
    const ontology=top?.id === branches[1]?.id, dialectic=top?.id === branches[2]?.id;
    const rules=ontology ? [[/主观能动|客观规律|从实际出发/,/主观能动|客观规律|尊重规律/],[/人工智能/,/人工智能/],[/物质与意识|意识|反作用|能动性/,/意识|人工智能/],[/运动|静止/,/运动|静止/],[/时空|时间|空间|存在形式/,/时间|空间|时空/],[/第一性|唯物|唯心|哲学基本|思维.*存在/,/唯物主义|唯心主义|哲学的基本问题|思维和存在/],[/同一性|可知|不可知/,/可知论|不可知论|认识世界/],[/物质/,/物质|客观实在/],[/实践|社会关系/,/实践|社会关系/]] : dialectic ? [[/量变|质变|质、量、度|适度/,/量变|质变|适度|数量界限/],[/否定|扬弃|肯定因素|螺旋|曲折/,/否定|扬弃|螺旋|曲折/],[/矛盾|对立|同一性|斗争性|两点论|重点论/,/矛盾|对立统一|两点论|重点论/],[/联系|条件性|普遍性|多样性|客观性/,/联系|条件/],[/发展|新事物|旧事物/,/发展|新事物|旧事物/],[/内容与形式|本质与现象|原因与结果|必然与偶然|现实与可能|五对基本环节/,/内容|形式|本质|现象|原因|结果|必然|偶然|现实|可能/],[/归纳|演绎|分析与综合|抽象|具体|逻辑与历史|辩证思维/,/归纳|演绎|分析|综合|抽象|具体|逻辑|历史/]] : [];
    const rule=rules.find(([re]) => re.test(title)); if (!rule) return links;
    const banks=ontology ? ["c1s1-q1","c1s1-q2"] : ["c1s23"], sections=ontology ? ["世界的物质性","客观规律性"] : ["联系和发展","三大规律"];
    const matches=q => rule[1].test([q.stem,...(q.options || []).map(o => o.text)].join(" "));
    add("课堂 · 相关主题题",DB.questions.filter(q => banks.includes(q.bank) && matches(q))); add("考研 · 相关主题题",DB.ofKaoyanSection(sections).filter(matches)); return links;
  }
  function inline(raw) { return esc(raw).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>"); }
  function notesHtml(n,raw=false) { return (n.notes || []).map(line => { if (raw) return `<div>${esc(line)}</div>`; let text=String(line).replace(/^\s*#{1,6}\s+/,"").replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/,""); if (/人民性|实践性|发展性/.test(n.title) && /(?:-\+|\+->|---)/.test(text)) text=text.replace(/\s*[-+]+>?.*$/,""); return `<p>${inline(text)}</p>`; }).join(""); }
  function diagramHtml(d) {
    if (d.type === "quantity-change") return `<figure class="mm-diagram"><figcaption><span class="mm-relation-mark">关系图</span>量变与质变的过程</figcaption><div class="mm-process"><div>量变<small>积累 · 必要准备</small></div><span aria-hidden="true">→</span><div class="mm-process-key">质变<small>突破度 · 必然结果</small></div><span aria-hidden="true">→</span><div>新的量变<small>新质基础上的积累</small></div></div><div class="mm-degree"><span>度</span>保持事物质的稳定性的数量界限</div><p>量变与质变相互渗透：总的量变中有部分质变，质变中有量的扩张。发展在新的基础上继续。</p><details class="mm-original"><summary>查看原笔记图示源码</summary><pre>${esc(d.source)}</pre></details></figure>`;
    if (d.type === "negation") return `<figure class="mm-diagram"><figcaption><span class="mm-relation-mark">关系图</span>两次否定 · 三个阶段</figcaption><div class="mm-negation-process"><div>肯定</div><span>量变 → 质变</span><div>否定</div><span>量变 → 质变</span><div class="mm-process-key">否定之否定<small>新的肯定</small></div></div><svg class="mm-spiral" viewBox="0 0 330 94" role="img" aria-label="每个周期的终点成为新周期的起点，在曲折中向更高阶段发展"><path class="mm-spiral-path" d="M12 78 C42 40 80 95 109 65 S168 73 195 44 S253 48 309 14"/><path class="mm-spiral-arrow" d="M299 14 L310 13 L307 24"/><text x="18" y="21">螺旋式上升 · 波浪式前进</text><text class="mm-spiral-sub" x="18" y="40">新的周期，从更高阶段继续</text></svg><p>每次否定都是质变；前一周期的终点是下一周期的起点。发展体现前进性与曲折性的统一，包含暂时的停顿甚至倒退。</p><div class="mm-sublation">扬弃 <span>既克服，又保留</span></div><details class="mm-original"><summary>查看原笔记图示源码</summary><pre>${esc(d.source)}</pre></details></figure>`;
    return "";
  }
  function traitsHtml(n) { if (!/四个特性/.test(n.title)) return ""; return `<figure class="mm-diagram"><figcaption><span class="mm-relation-mark">原文分组</span>四个特性</figcaption><div class="mm-traits"><span>科学性</span><div><span>人民性（本质属性）</span><span>实践性（基本观点）</span><span>发展性</span></div><b aria-hidden="true">}</b><strong>革命性</strong></div><p>人民性、实践性、发展性按原笔记括号分组指向革命性。</p></figure>`; }
  function subtreeHtml(n,depth=0) { return `<details class="mm-note-branch" ${depth === 0 ? "open" : ""}><summary>${esc(n.title)} <small>${n.children?.length ? `${n.children.length} 个下级` : kindLabel(n)}</small></summary><div class="mm-note-body"><button class="mm-note-jump" data-jump="${esc(n.id)}">在导图中定位 ↗</button><span class="mm-note-source">第 ${n.source?.line || "—"} 行</span><div class="mm-notes">${notesHtml(n)}</div>${traitsHtml(n)}${(n.diagrams || []).map(diagramHtml).join("")}${(n.children || []).map(c => subtreeHtml(c,depth+1)).join("")}</div></details>`; }
  function renderPanel() {
    const n=selected, path=pathOf(n), links=practiceLinks(n), questions=[...new Map(links.flatMap(l => l.questions).map(q => [q.id,q])).values()], done=questions.filter(q => Store.data.answers[q.id]), correct=done.filter(q => Store.data.answers[q.id].lastOk), pct=done.length ? Math.round(100*correct.length/done.length) : null;
    panel.innerHTML=`<div class="mm-panel-top"><span class="mm-eyebrow">${kindLabel(n)} · 原笔记导读</span><button data-command="locate" class="mm-panel-locate" title="定位当前节点">定位 ↗</button></div><h3>${esc(n.title)}</h3><nav class="mm-breadcrumb" aria-label="当前知识点路径">${path.map(p => `<button data-jump="${esc(p.id)}">${esc(p.title)}</button>`).join('<span aria-hidden="true">›</span>')}</nav><p class="mm-source">${esc(sourceLabel(n))}</p><div class="mm-notes mm-own-notes">${notesHtml(n)}</div>${traitsHtml(n)}${(n.diagrams || []).map(diagramHtml).join("")}${n.children?.length ? `<section class="mm-child-notes"><h4>下级知识点 <span>${n.children.length}</span></h4><p class="mm-panel-hint">保留原笔记层级，展开条目阅读完整说明。</p>${n.children.map(c => subtreeHtml(c)).join("")}</section>` : ""}<details class="mm-original"><summary>查看本节点原文</summary><div class="mm-raw-notes">${notesHtml(n,true)}</div></details>${links.length ? `<section class="mm-practice"><h4>关联练习</h4><div class="mm-practice-score"><strong>${pct === null ? "尚未作答" : pct+"%"}</strong><span>关联练习正确率<small>已做 ${done.length} / ${questions.length} 题</small></span></div><p>按关联题最近一次作答统计，反映该组练习的表现。</p><div class="mm-practice-actions">${links.map((l,i) => `<button class="btn small" data-practice="${i}">${esc(l.label)} <span>${l.questions.length} 题</span></button>`).join("")}</div></section>` : ""}`;
    panel.querySelectorAll("[data-practice]").forEach(button => button.onclick=() => { const link=links[Number(button.dataset.practice)]; Views.map.cleanup?.(); startQuiz({title:`导图 · ${n.title} · ${link.label}`,questions:link.questions,mode:"practice",back:"#/map"}); });
  }
  function mark(text,tokens) {
    const normalized=String(text), lower=normalized.toLocaleLowerCase(), ranges=[];
    for (const token of tokens) { let at=lower.indexOf(token); while (at !== -1) { ranges.push([at,at+token.length]); at=lower.indexOf(token,at+token.length); } }
    ranges.sort((a,b) => a[0]-b[0]); const merged=[];
    for (const range of ranges) { if (merged.length && range[0] <= merged[merged.length-1][1]) merged[merged.length-1][1]=Math.max(range[1],merged[merged.length-1][1]); else merged.push(range); }
    let out="",last=0; for (const [a,b] of merged) { out+=esc(normalized.slice(last,a))+`<mark>${esc(normalized.slice(a,b))}</mark>`; last=b; } return out+esc(normalized.slice(last));
  }
  function runSearch(reset=true) {
    if (reset) searchPage=0;
    const term=searchInput.value.trim().toLocaleLowerCase(), tokens=term.split(/\s+/).filter(Boolean), results=query("#mmResults"); results.hidden=!tokens.length;
    if (!tokens.length) { results.innerHTML=""; searchHits=[]; return; }
    const titleOnly=query("#mmSearchMode").value === "title"; searchHits=all.filter(n => tokens.every(t => (n.title+(titleOnly ? "" : " "+(n.notes || []).join(" "))).toLocaleLowerCase().includes(t)));
    const pageSize=8,pages=Math.max(1,Math.ceil(searchHits.length/pageSize)); searchPage=Math.min(searchPage,pages-1);
    results.innerHTML=`<div class="mm-results-head"><strong>找到 ${searchHits.length} 个${titleOnly ? "节点" : "原笔记条目"}</strong><span>点击结果展开路径并定位</span><button data-command="clearsearch">清除</button></div><div class="mm-result-items">${searchHits.slice(searchPage*pageSize,(searchPage+1)*pageSize).map(n => { const matching=(n.notes || []).find(x => tokens.some(t => x.toLocaleLowerCase().includes(t))) || ""; const snippet=matching.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)、]\s*)/,"").replace(/\*\*/g,"").replace(/`([^`]+)`/g,"$1"); return `<button class="mm-result" data-jump="${esc(n.id)}"><strong>${mark(n.title,tokens)}</strong>${!titleOnly && matching ? `<span>${mark(snippet,tokens)}</span>` : ""}<small>${esc(pathOf(n).slice(1,-1).map(p => p.title).join(" › "))} · 第 ${n.source?.line || "—"} 行</small></button>`; }).join("") || '<p class="mm-no-results">没有匹配条目。可尝试“矛盾”“度”“思维能力”等原笔记词语。</p>'}</div>${pages > 1 ? `<div class="mm-search-pages"><button data-page="-1" ${searchPage === 0 ? "disabled" : ""}>上一页</button><span>${searchPage+1} / ${pages}</span><button data-page="1" ${searchPage >= pages-1 ? "disabled" : ""}>下一页</button></div>` : ""}`;
    query("#mmStatus").textContent=`找到 ${searchHits.length} 个搜索结果`;
  }
  function command(name) {
    if (name === "zoomin") zoom(1.25); if (name === "zoomout") zoom(.8); if (name === "fit") fit();
    if (name === "locate") { if (!positions.has(selected.id)) reveal(selected); centerNode(selected); scrollTreeNode(selected); query(".mm-layout").scrollIntoView({block:"start"}); }
    if (name === "one") { visible.forEach(n => { if (n.children?.length) expanded.add(n.id); }); renderTree(); }
    if (name === "all") { (function open(n) { if (n.children?.length) expanded.add(n.id); (n.children || []).forEach(open); })(scope); renderTree(); centerNode(selected); }
    if (name === "reset") { expanded.clear(); expanded.add(scope.id); renderTree(); fit(); }
    if (name === "clearsearch") { searchInput.value=""; runSearch(); searchInput.focus(); }
  }
  listen(shell,"click",event => {
    const button=event.target.closest("button"); if (!button || !shell.contains(button)) return;
    if (button.dataset.scope) setScope(byId.get(button.dataset.scope));
    else if (button.dataset.mode) { mode=button.dataset.mode; canvas.hidden=mode !== "map"; outline.hidden=mode !== "outline"; shell.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed",b.dataset.mode === mode)); if (mode === "map") fit(); }
    else if (button.dataset.jump) reveal(byId.get(button.dataset.jump));
    else if (button.dataset.toggle) { const n=byId.get(button.dataset.toggle); toggle(n); focusTreeNode(n,true); }
    else if (button.dataset.node) { const n=byId.get(button.dataset.node); selectNode(n); focusTreeNode(n); }
    else if (button.dataset.command) command(button.dataset.command);
    else if (button.dataset.page) { searchPage+=Number(button.dataset.page); runSearch(false); }
  });
  listen(searchInput,"input",() => runSearch()); listen(query("#mmSearchMode"),"change",() => runSearch());
  listen(searchInput,"keydown",event => { if (event.key === "Enter" && searchHits.length && searchInput.value.trim()) { event.preventDefault(); reveal(searchHits[searchPage*8]); } if (event.key === "Escape") command("clearsearch"); });
  listen(shell,"keydown",event => {
    const el=event.target.closest("[data-node],[data-toggle]"); if (!el || !el.closest("#mmSvg,#mmOutline")) return;
    const n=byId.get(el.dataset.node || el.dataset.toggle); let target=null;
    if (["Enter"," "].includes(event.key)) { event.preventDefault(); el.dataset.toggle ? toggle(n) : selectNode(n); target=n; }
    else if (event.key === "ArrowRight") { event.preventDefault(); if (n.children?.length && !expanded.has(n.id)) toggle(n); else target=n.children?.[0]; }
    else if (event.key === "ArrowLeft") { event.preventDefault(); if (n.children?.length && expanded.has(n.id)) toggle(n); else if (n.id !== scope.id) target=parents.get(n.id); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); target=visible[visible.findIndex(x => x.id === n.id)+(event.key === "ArrowDown" ? 1 : -1)]; }
    else if (event.key === "Home") { event.preventDefault(); target=scope; } else return;
    const id=target?.id || n.id; if (target) selectNode(target);
    focusTreeNode(byId.get(id)); if (target && mode === "map") centerNode(target);
  });
  function point(event) { const rect=svg.getBoundingClientRect(); return {x:event.clientX-rect.left,y:event.clientY-rect.top}; }
  function startGesture() { const pts=[...pointers.values()]; if (pts.length === 1) gesture={x:pts[0].x,y:pts[0].y,cx:cam.x,cy:cam.y,moved:false,action:pts[0].action,pinch:false}; else if (pts.length >= 2) { const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}; gesture={...mid,cx:cam.x,cy:cam.y,k:cam.k,distance:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),moved:true,pinch:true}; } }
  listen(svg,"pointerdown",event => { if (event.button && event.pointerType === "mouse") return; const action=event.target.closest("[data-toggle],[data-node]"); pointers.set(event.pointerId,{...point(event),action:action ? {id:action.dataset.toggle || action.dataset.node,toggle:!!action.dataset.toggle} : null}); svg.setPointerCapture(event.pointerId); startGesture(); });
  listen(svg,"pointermove",event => { if (!pointers.has(event.pointerId) || !gesture) return; pointers.set(event.pointerId,{...pointers.get(event.pointerId),...point(event)}); const pts=[...pointers.values()]; if (pts.length > 1 && gesture.pinch) { const x=(pts[0].x+pts[1].x)/2,y=(pts[0].y+pts[1].y)/2,d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y); cam.k=Math.min(3,Math.max(.08,gesture.k*d/Math.max(gesture.distance,1))); cam.x=x-(gesture.x-gesture.cx)*cam.k/gesture.k; cam.y=y-(gesture.y-gesture.cy)*cam.k/gesture.k; } else if (!gesture.pinch) { const dx=pts[0].x-gesture.x,dy=pts[0].y-gesture.y; if (Math.hypot(dx,dy)>5) gesture.moved=true; if (gesture.moved) { cam.x=gesture.cx+dx; cam.y=gesture.cy+dy; } } applyCam(); });
  function endPointer(event,cancel=false) { if (!pointers.has(event.pointerId)) return; const action=!cancel && pointers.size === 1 && gesture && !gesture.moved ? gesture.action : null, wasPinch=gesture?.pinch; pointers.delete(event.pointerId); if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId); if (pointers.size) { startGesture(); if (wasPinch) { gesture.moved=true; gesture.action=null; } } else gesture=null; if (action) { const n=byId.get(action.id); action.toggle ? toggle(n) : selectNode(n); focusTreeNode(n,action.toggle); } }
  listen(svg,"pointerup",event => endPointer(event)); listen(svg,"pointercancel",event => endPointer(event,true));
  listen(svg,"wheel",event => { event.preventDefault(); const p=point(event); zoom(Math.exp(-Math.max(-80,Math.min(80,event.deltaY))*.008),p.x,p.y); },{passive:false});
  listen(window,"hashchange",() => { if (!location.hash.startsWith("#/map")) Views.map.cleanup?.(); });
  Views.map.cleanup=function () { if (disposed) return; disposed=true; observer?.disconnect(); cancelAnimationFrame(frame); pointers.clear(); gesture=null; removers.splice(0).forEach(remove => remove()); };
  if (typeof ResizeObserver !== "undefined") { observer=new ResizeObserver(() => { if (disposed || canvas.hidden) return; const size={w:canvas.clientWidth,h:canvas.clientHeight}; if (!previousSize) fit(); else { cam.x+=(size.w-previousSize.w)/2; cam.y+=(size.h-previousSize.h)/2; applyCam(); } previousSize=size; }); observer.observe(canvas); }
  renderTree(); renderPanel(); frame=requestAnimationFrame(() => { if (!disposed) fit(); });
};

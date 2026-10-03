/* ============================================================
   mindmap.js — 动态思维导图
   - 数据：data/chapters.json（由 chapter-01.md 标题层级解析）
   - 交互：平移 / 缩放 / 折叠展开 / 节点详情侧栏
   - 特色：节点挂接「关联题目跳转」与「掌握度标记」，
           跳转规则见 MAP_LINK_RULES（继承式，子节点继承父节点链接）
   详见 DOCUMENTATION.md 第 4.2 节
   ============================================================ */
"use strict";

/* 节点 → 题库的跳转规则（按标题正则匹配，子节点自动继承祖先链接） */
const MAP_LINK_RULES = [
  { re: /马克思主义的构成/,
    links: [{ label: "考研 · 绪论真题", kySec: "绪论" }] },
  { re: /本体论|物质|意识|客观规律|主观能动/,
    links: [
      { label: "课堂小测1", bank: "c1s1-q1" },
      { label: "课堂小测2", bank: "c1s1-q2" },
      { label: "考研 · 世界的物质性", kySec: "世界的物质性" },
      { label: "考研 · 规律与能动性", kySec: "客观规律性" },
    ] },
  { re: /辩证法|联系|发展|环节|方法论/,
    links: [
      { label: "辩证法课堂练习", bank: "c1s23" },
      { label: "考研 · 三大规律", kySec: "三大规律" },
      { label: "考研 · 联系和发展", kySec: "联系和发展" },
    ] },
];

Views.map = function () {
  const root = DB.chapters;
  const collapsed = new Set();     // 收起的节点 id
  const expandedAll = { v: false };
  let selected = null;

  // 初始：默认收起第 3 层（### 以下）及以下，保证首屏清爽
  (function initCollapse(n) {
    if (n.level >= 3 && n.children.length) collapsed.add(n.id);
    n.children.forEach(initCollapse);
  })(root);

  // 预计算：每个节点的有效链接（含继承）与题目集合
  function effectiveLinks(n) {
    const out = [];
    const walk = (node, acc) => {
      const own = MAP_LINK_RULES.filter(r => r.re.test(node.title)).flatMap(r => r.links);
      const merged = [...acc, ...own].filter((l, i, arr) => arr.findIndex(x => x.label === l.label) === i);
      if (node.id === n.id) { out.push(...merged); return true; }
      return node.children.some(c => walk(c, merged));
    };
    walk(root, []);
    return out;
  }
  function linkQuestions(links) {
    const seen = new Set(); const out = [];
    for (const l of links) {
      const qs = l.bank ? DB.ofBank(l.bank) : DB.ofKaoyanSection(l.kySec);
      for (const q of qs) if (!seen.has(q.id)) { seen.add(q.id); out.push(q); }
    }
    return out;
  }
  function mastery(links) {
    const qs = linkQuestions(links);
    if (!qs.length) return null;
    const done = qs.filter(q => Store.data.answers[q.id]);
    const ok = done.filter(q => Store.data.answers[q.id].lastOk).length;
    return { total: qs.length, done: done.length, pct: done.length ? Math.round(100 * ok / done.length) : 0 };
  }

  $("#view").innerHTML = `
    <h2 class="section-title">思维导图 <small>MIND MAP · 点击节点看导读，点 ± 折叠展开</small></h2>
    <div class="map-layout">
      <div class="map-canvas-wrap" id="mapWrap">
        <div class="map-tools">
          <button id="zoomIn" title="放大">＋</button>
          <button id="zoomOut" title="缩小">－</button>
          <button id="zoomFit" title="复位">⌂</button>
          <button id="expandAll" title="全部展开">⇊</button>
          <button id="collapseAll" title="全部收起">⇈</button>
        </div>
        <svg id="mapSvg" width="100%" height="100%"><g id="mapG"></g></svg>
      </div>
      <div class="card map-panel" id="mapPanel">
        <h3>节点导读</h3>
        <p class="muted" style="font-size:13px">点击左侧任意节点，这里将显示该知识点的笔记导读与关联题目；挂有题目的节点在图中有
          <span style="color:var(--green)">●</span> 标记并显示掌握度。</p>
        <p class="muted" style="font-size:12.5px">根节点挂有「期末真题卷」总复习入口。</p>
      </div>
    </div>`;

  const svg = $("#mapSvg"), g = $("#mapG"), wrap = $("#mapWrap");
  const ROW_H = 44, NODE_PAD = 14, CHAR_W = 12.5, COL_GAP = 46;

  /* ---- 布局：先算每个可见子树的 y 占位，再按层算 x ---- */
  function layout() {
    const nodes = [], links = [];
    let leafY = 0;
    const visible = n => expandedAll.v || !collapsed.has(n.id);

    function place(n, depth) {
      const kids = visible(n) ? n.children : [];
      let y;
      if (!kids.length) { y = leafY; leafY += ROW_H; }
      else {
        kids.forEach(k => place(k, depth + 1));
        y = (kids[0]._y + kids[kids.length - 1]._y) / 2;
      }
      const w = Math.min(230, NODE_PAD * 2 + [...n.title].length * CHAR_W);
      n._y = y; n._depth = depth; n._w = w;
      nodes.push(n);
      kids.forEach(k => links.push([n, k]));
    }
    place(root, 0);
    // 深度列 x：按上一层最大宽度累加
    const colX = [0];
    for (let d = 0; ; d++) {
      const atD = nodes.filter(n => n._depth === d);
      if (!atD.length) break;
      const maxRight = Math.max(...atD.map(n => n._w));
      colX[d + 1] = colX[d] + maxRight + COL_GAP;
    }
    nodes.forEach(n => n._x = colX[n._depth]);
    return { nodes, links, height: Math.max(leafY, 320), width: colX[nodes.length ? Math.max(...nodes.map(n => n._depth)) + 1 : 1] };
  }

  function render() {
    const { nodes, links, height } = layout();
    const maxX = Math.max(...nodes.map(n => n._x + n._w)) + 60;
    g.innerHTML = `
      ${links.map(([p, c]) => {
        const x1 = p._x + p._w, y1 = p._y + 15, x2 = c._x, y2 = c._y + 15;
        const mx = (x1 + x2) / 2;
        return `<path class="map-link" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      }).join("")}
      ${nodes.map(n => {
        const linksN = effectiveLinks(n);
        const m = mastery(linksN);
        const label = [...n.title].length > 14 ? [...n.title].slice(0, 13).join("") + "…" : n.title;
        const showToggle = n.children.length > 0;
        const isCollapsed = !expandedAll.v && collapsed.has(n.id);
        return `
        <g class="map-node lv${Math.min(n.level, 1)} ${linksN.length ? "has-link" : ""}" data-nid="${n.id}"
           transform="translate(${n._x},${n._y})">
          <rect width="${n._w}" height="30"></rect>
          ${linksN.length ? `<circle class="badge-dot" cx="9" cy="15" r="3.2"></circle>` : ""}
          <text x="${linksN.length ? 20 : 12}" y="19">${escapeHtml(label)}</text>
          ${m && m.done ? `<text class="node-pct" x="${n._w - 8}" y="20" text-anchor="end">${m.pct}%</text>` : ""}
          ${showToggle ? `
            <g class="map-toggle" data-tid="${n.id}" transform="translate(${n._w + 12},15)">
              <circle r="8"></circle>
              <text y="3.5">${isCollapsed ? "+" : "−"}</text>
            </g>` : ""}
        </g>`;
      }).join("")}`;
    g.dataset.h = height; g.dataset.w = maxX;
    bindSvg();
  }

  /* ---- 平移缩放 ---- */
  const cam = { x: 30, y: 40, k: 1 };
  function applyCam() { g.setAttribute("transform", `translate(${cam.x},${cam.y}) scale(${cam.k})`); }
  function zoomAt(f, cx, cy) {
    const k2 = Math.min(2.2, Math.max(.35, cam.k * f));
    cam.x = cx - (cx - cam.x) * (k2 / cam.k);
    cam.y = cy - (cy - cam.y) * (k2 / cam.k);
    cam.k = k2; applyCam();
  }
  let drag = null;
  wrap.addEventListener("pointerdown", e => {
    if (e.target.closest(".map-toggle") || e.target.closest(".map-node")) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", e => {
    if (!drag) return;
    cam.x = drag.cx + e.clientX - drag.x;
    cam.y = drag.cy + e.clientY - drag.y;
    applyCam();
  });
  wrap.addEventListener("pointerup", () => drag = null);
  wrap.addEventListener("wheel", e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.9, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("#zoomIn").onclick = () => zoomAt(1.25, wrap.clientWidth / 2, wrap.clientHeight / 2);
  $("#zoomOut").onclick = () => zoomAt(0.8, wrap.clientWidth / 2, wrap.clientHeight / 2);
  $("#zoomFit").onclick = () => { cam.x = 30; cam.y = 40; cam.k = 1; applyCam(); };
  $("#expandAll").onclick = () => { expandedAll.v = true; render(); };
  $("#collapseAll").onclick = () => {
    expandedAll.v = false;
    collapsed.clear();
    (function walk(n) { if (n.level >= 3 && n.children.length) collapsed.add(n.id); n.children.forEach(walk); })(root);
    render();
  };

  function bindSvg() {
    $$(".map-node", g).forEach(el => el.onclick = e => {
      if (e.target.closest(".map-toggle")) return;
      const n = findNode(el.dataset.nid);
      selectNode(n);
    });
    $$(".map-toggle", g).forEach(el => el.onclick = () => {
      const id = el.dataset.tid;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    });
  }
  function findNode(id) {
    let hit = null;
    (function walk(n) { if (n.id === id) hit = n; n.children.forEach(walk); })(root);
    return hit;
  }
  function pathOf(n) {
    const path = [];
    (function walk(node, acc) {
      const cur = [...acc, node.title];
      if (node.id === n.id) { path.push(...cur); return; }
      node.children.forEach(c => walk(c, cur));
    })(root, []);
    return path;
  }

  function selectNode(n) {
    selected = n;
    const links = n.id === "root"
      ? [{ label: "期末真题 · 全真小卷", bank: "final-2024" }, ...effectiveLinks(n)]
      : effectiveLinks(n);
    const m = mastery(links);
    const panel = $("#mapPanel");
    panel.innerHTML = `
      <h3>${escapeHtml(n.title)}</h3>
      <p class="muted" style="font-size:11.5px">${pathOf(n).map(escapeHtml).join(" › ")}</p>
      ${m ? `<div class="bank-meta">
        <span class="chip">关联题 ${m.total}</span>
        <span class="chip">已做 ${m.done}</span>
        <span class="chip">掌握度 ${m.pct}%</span>
      </div>
      <div class="progressline"><i style="width:${m.total ? 100 * m.done / m.total : 0}%"></i></div>` : ""}
      ${n.notes.length ? `<ul class="notes">${n.notes.map(x => `<li>${mdLite(x)}</li>`).join("")}</ul>`
                       : `<p class="muted" style="font-size:13px">（此节点为分支节点，详见其子节点。）</p>`}
      ${links.length ? `<h4 style="font-size:13px;color:var(--gold);letter-spacing:1px;margin:12px 0 8px">去刷本节题</h4>` : ""}
      <div class="bank-actions" style="flex-wrap:wrap">
        ${links.map((l, i) => `<button class="btn small" data-mlink="${i}">${escapeHtml(l.label)}</button>`).join("")}
      </div>`;
    $$("#mapPanel [data-mlink]").forEach(btn => btn.onclick = () => {
      const l = links[+btn.dataset.mlink];
      const qs = l.bank ? DB.ofBank(l.bank) : DB.ofKaoyanSection(l.kySec);
      startQuiz({ title: `导图 · ${n.title} · ${l.label}`, questions: qs, mode: "practice", back: "#/map" });
    });
  }

  render(); applyCam();
};

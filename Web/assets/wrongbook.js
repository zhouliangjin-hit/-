/* ============================================================
   wrongbook.js — 错题本
   规则（详见 DOCUMENTATION.md 第 4.4 节）：
   - 任意模式答错 → 自动入册（计数 +1），答错时重置“已掌握”
   - 在错题重练中答对 → 可标记「已掌握」（条目保留，置灰沉淀）
   - 支持按题库筛选、手动移除、整卷重练
   主观题自评「还需努力」会以 S: 前缀条目入册。
   ============================================================ */
"use strict";

let wrongTab = "active"; // active | mastered | all
let wrongBankFilter = "all";

Views.wrong = function () {
  const d = Store.data;
  const book = d.wrongBook;

  function info(qid) {
    if (qid.startsWith("S:")) {
      const s = DB.subjective.find(x => "S:" + x.id === qid);
      return s ? { title: s.title, kind: s.kind, bank: s.bankName, isSub: true, raw: s } : null;
    }
    const q = DB.byId[qid];
    return q ? { title: q.stem, kind: TYPE_NAME[q.type], bank: q.bankName, isSub: false, raw: q } : null;
  }

  const entries = Object.entries(book)
    .map(([qid, w]) => ({ qid, ...w, meta: info(qid) }))
    .filter(e => e.meta)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const active = entries.filter(e => !e.mastered);
  const mastered = entries.filter(e => e.mastered);
  let shown = wrongTab === "active" ? active : wrongTab === "mastered" ? mastered : entries;
  if (wrongBankFilter !== "all") shown = shown.filter(e => e.meta.bank === wrongBankFilter);

  const bankNames = [...new Set(entries.map(e => e.meta.bank))];

  $("#view").innerHTML = `
    <h2 class="section-title">错题本 <small>WRONG BOOK · ${active.length} 待攻克 / ${mastered.length} 已掌握</small></h2>
    <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div class="tabs" style="margin:0">
        <button class="${wrongTab === "active" ? "on" : ""}" data-tab="active">待攻克 (${active.length})</button>
        <button class="${wrongTab === "mastered" ? "on" : ""}" data-tab="mastered">已掌握 (${mastered.length})</button>
        <button class="${wrongTab === "all" ? "on" : ""}" data-tab="all">全部 (${entries.length})</button>
      </div>
      <select id="bankFilter" class="btn small" style="appearance:auto">
        <option value="all">全部题库</option>
        ${bankNames.map(b => `<option ${wrongBankFilter === b ? "selected" : ""}>${escapeHtml(b)}</option>`).join("")}
      </select>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="btn primary small" id="drill" ${active.filter(e => !e.meta.isSub).length ? "" : "disabled"}>
          ⚑ 错题重练（${active.filter(e => !e.meta.isSub).length}）</button>
      </div>
    </div>
    <div class="subj-list" style="margin-top:16px">
      ${shown.length ? shown.map(e => `
        <div class="card wrong-item ${e.mastered ? "mastered" : ""}">
          <div class="wi-body">
            <div class="wi-stem">${escapeHtml(e.meta.title.slice(0, 90))}${e.meta.title.length > 90 ? "…" : ""}</div>
            <div class="wi-meta">
              <span class="tag ${e.meta.isSub ? "gold" : "blue"}">${e.meta.kind}</span>
              <span>${escapeHtml(e.meta.bank)}</span>
              <span>错 ${e.count} 次</span>
              ${e.ts ? `<span>入册 ${fmtDate(e.ts)}</span>` : ""}
              ${e.mastered ? '<span class="tag green">已掌握</span>' : ""}
            </div>
          </div>
          <div class="wi-act">
            ${e.meta.isSub
              ? `<a class="btn small" href="#/subjective">去复习</a>`
              : `<button class="btn small" data-redo="${e.qid}">重做</button>`}
            ${!e.mastered && !e.meta.isSub ? `<button class="btn small" data-master="${e.qid}">标记掌握</button>` : ""}
            <button class="btn small" data-del="${e.qid}">移除</button>
          </div>
        </div>`).join("")
      : `<div class="empty">${entries.length ? "当前筛选下没有错题" : "错题本空空如也 —— 去做几组题，答错的题会自动归集到这里。"}</div>`}
    </div>`;

  $$("#view [data-tab]").forEach(b => b.onclick = () => { wrongTab = b.dataset.tab; Views.wrong(); });
  $("#bankFilter").onchange = e => { wrongBankFilter = e.target.value; Views.wrong(); };
  $$("#view [data-del]").forEach(b => b.onclick = () => { Store.removeWrong(b.dataset.del); toast("已移除"); Views.wrong(); });
  $$("#view [data-master]").forEach(b => b.onclick = () => { Store.markMastered(b.dataset.master, true); toast("已标记掌握"); Views.wrong(); });
  $$("#view [data-redo]").forEach(b => b.onclick = () => {
    const q = DB.byId[b.dataset.redo];
    startQuiz({
      title: "错题重做（1题）", questions: [q], mode: "practice", back: "#/wrong",
      onFinish: () => null,
    });
  });
  $("#drill")?.addEventListener("click", () => {
    const qs = active.filter(e => !e.meta.isSub).map(e => DB.byId[e.qid]).filter(Boolean);
    startQuiz({
      title: "错题重练 · 整卷", questions: shuffle(qs), mode: "practice", back: "#/wrong",
      onFinish: res => {
        // 重练全对自动标记掌握（以本次逐题记录为准）
        if (res.pct === 100) {
          qs.forEach(q => Store.markMastered(q.id, true));
          return { stars: null, message: "全部答对！这批错题已自动标记为已掌握。" };
        }
        return null;
      },
    });
  });
};

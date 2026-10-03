/* ============================================================
   stats.js — 成绩分析
   维度：总览 / 近14天作答趋势 / 题库正确率 / 题型正确率 /
        薄弱知识点 TOP5（含针对训练）/ 最近成绩记录
   图表为零依赖手写 SVG（详见 DOCUMENTATION.md 第 4.5 节）
   ============================================================ */
"use strict";

Views.stats = function () {
  const d = Store.data;
  const att = d.attempts.filter(a => !String(a.qid).startsWith("S:"));

  /* ---- 总览 ---- */
  const totalDone = att.length;
  const totalOk = att.filter(a => a.ok).length;
  const totalPct = totalDone ? Math.round(100 * totalOk / totalDone) : 0;
  const stars = Object.values(d.levels).reduce((s, l) => s + (l.stars || 0), 0);
  const passed = Object.values(d.levels).filter(l => l.stars > 0).length;
  const wrongActive = Object.values(d.wrongBook).filter(w => !w.mastered).length;

  /* ---- 近 14 天 ---- */
  const days14 = [...Array(14)].map((_, i) => {
    const t = Date.now() - (13 - i) * 86400000;
    const k = dayKey(t);
    const list = att.filter(a => dayKey(a.ts) === k);
    return { k, n: list.length, ok: list.filter(a => a.ok).length,
             label: `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}` };
  });
  const maxN = Math.max(1, ...days14.map(x => x.n));

  /* ---- 按题库正确率 ---- */
  const perBank = DB.banks.map(b => {
    const ids = new Set(DB.ofBank(b.id).map(q => q.id));
    const list = att.filter(a => ids.has(a.qid));
    const ok = list.filter(a => a.ok).length;
    return { name: b.name, n: list.length, pct: list.length ? Math.round(100 * ok / list.length) : null };
  });

  /* ---- 按题型正确率 ---- */
  const perType = ["judge", "single", "multi"].map(t => {
    const ids = new Set(DB.questions.filter(q => q.type === t).map(q => q.id));
    const list = att.filter(a => ids.has(a.qid));
    const ok = list.filter(a => a.ok).length;
    return { name: TYPE_NAME[t], n: list.length, pct: list.length ? Math.round(100 * ok / list.length) : null };
  });

  /* ---- 薄弱知识点（按末层标签聚合，样本≥3 才上榜） ---- */
  const tagMap = {};
  for (const q of DB.questions) {
    const key = q.bank === "kaoyan" ? `考研 · ${q.section}` : q.bankName;
    tagMap[key] = tagMap[key] || { n: 0, ok: 0 };
  }
  for (const a of att) {
    const q = DB.byId[a.qid]; if (!q) continue;
    const key = q.bank === "kaoyan" ? `考研 · ${q.section}` : q.bankName;
    if (tagMap[key]) { tagMap[key].n++; if (a.ok) tagMap[key].ok++; }
  }
  const weak = Object.entries(tagMap)
    .filter(([, v]) => v.n >= 3)
    .map(([k, v]) => ({ k, ...v, pct: Math.round(100 * v.ok / v.n) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  const recent = [...d.sessions].reverse().slice(0, 8);

  $("#view").innerHTML = `
    <h2 class="section-title">成绩分析 <small>ANALYTICS</small></h2>

    <div class="stats-grid">
      ${[
        [totalDone, "累计作答(题)", ""], [totalPct + "%", "总正确率", ""],
        [Store.streak() + " 天", "连续学习", ""],
        [`${passed}/${typeof LEVELS !== "undefined" ? LEVELS.length : 10} 关`, `闯关进度 · ★${stars}`, ""],
        [wrongActive, "待攻克错题", ""],
      ].map(([n, l]) => `<div class="stat-tile card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join("")}
    </div>

    <div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:16px">
      <div class="card chart-card">
        <h3>近 14 天作答趋势</h3>
        <svg viewBox="0 0 560 170" style="width:100%;margin-top:8px">
          ${[0, 1, 2, 3].map(i => {
            const y = 20 + i * 35;
            return `<line x1="34" y1="${y}" x2="545" y2="${y}" stroke="var(--line)" stroke-width="1" ${i === 3 ? 'stroke-dasharray="0"' : 'stroke-dasharray="3 4"'}/>
                    <text x="30" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--mut)">${Math.round(maxN * (3 - i) / 3)}</text>`;
          }).join("")}
          ${days14.map((x, i) => {
            const bw = 22, gap = (545 - 34 - 14 * bw) / 13;
            const px = 34 + i * (bw + gap), h = x.n ? Math.max(3, 110 * x.n / maxN) : 2;
            const y = 130 - h;
            const okH = x.n ? h * x.ok / x.n : 0;
            return `
              <rect x="${px}" y="${y}" width="${bw}" height="${h}" rx="4" fill="var(--red-soft)"/>
              <rect x="${px}" y="${130 - okH}" width="${bw}" height="${okH}" rx="4" fill="var(--red)"/>
              <text x="${px + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="9" fill="var(--ink-2)">${x.n || ""}</text>
              <text x="${px + bw / 2}" y="146" text-anchor="middle" font-size="8.5" fill="var(--mut)">${x.label}</text>
              <title>${x.label}：作答 ${x.n}，答对 ${x.ok}</title>`;
          }).join("")}
        </svg>
        <p class="muted" style="font-size:11.5px;margin-top:2px">
          <span style="color:var(--red)">■</span> 答对数　<span style="color:var(--red-soft)">■</span> 作答总数（鼠标悬停看明细）</p>
      </div>

      <div class="card chart-card">
        <h3>题型正确率</h3>
        <svg viewBox="0 0 260 150" style="width:100%;margin-top:8px">
          ${perType.map((t, i) => {
            const h = t.pct == null ? 0 : Math.max(3, 100 * t.pct / 100);
            const x = 34 + i * 74, w = 42;
            return `
              <rect x="${x}" y="${120 - h}" width="${w}" height="${h}" rx="6"
                    fill="${["var(--gold)", "var(--red)", "var(--blue)"][i]}" opacity="${t.pct == null ? .15 : .9}"/>
              <text x="${x + w / 2}" y="${112 - h}" text-anchor="middle" font-size="12" font-weight="700"
                    fill="var(--ink)">${t.pct == null ? "–" : t.pct + "%"}</text>
              <text x="${x + w / 2}" y="136" text-anchor="middle" font-size="10.5" fill="var(--ink-2)">${t.name}</text>
              <text x="${x + w / 2}" y="148" text-anchor="middle" font-size="9" fill="var(--mut)">${t.n} 次作答</text>`;
          }).join("")}
        </svg>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px">
      <div class="card chart-card">
        <h3>题库正确率</h3>
        <div style="margin-top:12px">
          ${perBank.map(b => `
            <div class="hbar-row">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
              <div class="bar"><i style="width:${b.pct ?? 0}%"></i></div>
              <span class="val">${b.pct == null ? "未开始" : b.pct + "% · " + b.n + "次"}</span>
            </div>`).join("")}
        </div>
        <h3 style="margin-top:22px">薄弱知识点 TOP5 <span class="tag red" style="font-size:10px">按正确率升序 · 样本≥3</span></h3>
        ${weak.length ? `<ul class="weak-list" style="margin-top:10px;padding-left:0;list-style:none">
          ${weak.map(w => `
            <li>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span>${escapeHtml(w.k.replace(/　/g, " "))}</span>
                <span class="${w.pct < 60 ? "" : "muted"}" style="color:${w.pct < 60 ? "var(--red)" : ""};font-weight:${w.pct < 60 ? 700 : 400}">
                  ${w.pct}%（${w.ok}/${w.n}）</span>
              </div>
              <div class="progressline" style="margin-top:4px"><i style="width:${w.pct}%"></i></div>
            </li>`).join("")}
        </ul>
        <button class="btn primary" id="drillWeak">⚑ 针对训练（覆盖以上全部考点）</button>
        ` : '<p class="muted" style="margin-top:8px">作答样本还太少（每个考点≥3次作答后上榜），先去刷题吧。</p>'}
      </div>

      <div class="card chart-card">
        <h3>最近成绩记录</h3>
        ${recent.length ? `
        <table class="sess-table">
          <thead><tr><th>时间</th><th>内容</th><th>模式</th><th>成绩</th><th>用时</th></tr></thead>
          <tbody>
            ${recent.map(s => `
              <tr>
                <td class="muted">${fmtDate(s.ts)}</td>
                <td>${escapeHtml((s.title || "").slice(0, 18))}${(s.title || "").length > 18 ? "…" : ""}</td>
                <td>${s.mode === "exam" ? "闯关/考试" : s.mode === "practice" ? "练习" : "自评"}</td>
                <td><strong style="color:${s.pct >= 60 ? "var(--green)" : "var(--red)"}">${s.pct}%</strong>
                  <span class="muted">(${s.correct}/${s.total})</span>
                  ${s.stars ? " ★".repeat(s.stars) : ""}</td>
                <td class="muted">${fmtDur(s.durSec)}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : '<p class="muted">还没有成绩记录，去完成一组练习或一次闯关吧。</p>'}
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" id="exportData">导出学习数据(JSON)</button>
          <button class="btn small" id="resetData" style="color:var(--red)">清空全部学习记录</button>
        </div>
      </div>
    </div>`;

  $("#drillWeak")?.addEventListener("click", () => {
    const keys = weak.map(w => w.k);
    const pool = DB.questions.filter(q => keys.includes(q.bank === "kaoyan" ? `考研 · ${q.section}` : q.bankName));
    startQuiz({
      title: "薄弱知识点 · 针对训练",
      questions: shuffle(pool).slice(0, 20), mode: "practice", back: "#/stats",
    });
  });
  $("#exportData").onclick = () => {
    const blob = new Blob([JSON.stringify(Store.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mayuan-study-backup-${dayKey()}.json`;
    a.click();
    toast("已导出备份文件");
  };
  $("#resetData").onclick = () => {
    if (!confirm("确定清空全部学习记录？此操作不可撤销（可先导出备份）。")) return;
    localStorage.removeItem(Store.KEY);
    Store.load(); toast("已清空，重新开始"); route();
  };
};

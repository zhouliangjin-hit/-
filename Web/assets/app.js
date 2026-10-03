/* ============================================================
   app.js — 应用内核
   职责：数据加载(DB) / 本地存档(Store) / 路由(Router) /
        通用工具 / 首页 / 主观题 / 关于页
   架构约定详见 DOCUMENTATION.md 第 3、5 节
   ============================================================ */
"use strict";

/* ---------------- 工具 ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const PORTRAIT_SRC = $(".ink-watermark")?.getAttribute("src") || "assets/marx-engels.png";
const TYPE_NAME = { judge: "判断题", single: "单选题", multi: "多选题" };

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/** 轻量 markdown：先转义，再支持 **粗体**、换行、"- "列表与 > 引用。 */
function mdLite(raw) {
  let s = escapeHtml(raw || "");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let html = "", inList = false;
  for (const l of lines) {
    const isItem = /^[-•]\s+/.test(l) || /^\d+[.、)]\s/.test(l);
    const isQuote = l.startsWith("&gt;") || l.startsWith(">");
    if (isItem) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${l.replace(/^[-•]\s+/, "")}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += isQuote
        ? `<p class="quote">${l.replace(/^&gt;|^>/, "")}</p>`
        : `<p>${l}</p>`;
    }
  }
  return html + (inList ? "</ul>" : "");
}
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDur(sec) {
  if (sec < 60) return `${sec}秒`;
  return `${Math.floor(sec / 60)}分${sec % 60 ? (sec % 60) + "秒" : ""}`;
}
function toast(msg) {
  $(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- 本地存档 Store ----------------
   localStorage 键：mayuan.study.v1
   结构约定见 DOCUMENTATION.md「localStorage 存档结构」 */
function isStudyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** 只检查数据，不解释或执行内容；连未知字段内的危险键也拒绝。 */
function assertSafeStudyObject(value) {
  const pending = [value];
  let visited = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++visited > 200000) throw new Error("备份内容过多，请选择本应用导出的学习备份。");
    if (item === null || typeof item !== "object") continue;
    if (!Array.isArray(item) && !isStudyObject(item)) throw new Error("备份包含不支持的数据类型。");
    for (const key of Object.keys(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new Error("备份含有不安全的字段，已拒绝导入。");
      }
      pending.push(item[key]);
    }
  }
}

/** 存档校验与复制；knownIds 只在题库已加载后用于过滤旧题号。 */
function normalizeStudyData(raw, { requireComplete = false, knownIds = null } = {}) {
  assertSafeStudyObject(raw);
  if (!isStudyObject(raw)) throw new Error("学习存档应是一个 JSON 对象。");
  const fields = ["answers", "wrongBook", "attempts", "sessions", "levels", "days"];
  if (requireComplete && fields.some(key => !Object.hasOwn(raw, key))) {
    throw new Error("备份缺少学习记录字段，请选择本应用导出的 JSON 文件。");
  }
  const data = Store.defaults();
  const ignoredIds = new Set();
  const fail = field => { throw new Error(`学习存档中的 ${field} 格式不正确。`); };
  const object = (value, field) => { if (!isStudyObject(value)) fail(field); return value; };
  const number = (value, field, max = 1000000000, integer = true) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max
      || (integer && !Number.isSafeInteger(value))) fail(field);
    return value;
  };
  const bool = (value, field) => { if (typeof value !== "boolean") fail(field); return value; };
  const text = (value, field, max = 500) => {
    if (typeof value !== "string" || value.length > max) fail(field);
    return value;
  };
  const timestamp = (value, field) => number(value, field, 8640000000000000);
  const questionId = (value, field) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,120}$/.test(value)) fail(field);
    if (knownIds && !knownIds.has(value)) { ignoredIds.add(value); return false; }
    return true;
  };
  const mode = (value, field) => {
    if (!["practice", "exam", "wrong", "subjective"].includes(value)) fail(field);
    return value;
  };

  for (const [qid, value] of Object.entries(object(raw.answers === undefined ? {} : raw.answers, "answers"))) {
    const a = object(value, "answers");
    const entry = {
      tries: number(a.tries, "answers.tries"), ok: number(a.ok, "answers.ok"),
      wrong: number(a.wrong, "answers.wrong"), lastOk: bool(a.lastOk, "answers.lastOk"),
      lastTs: timestamp(a.lastTs, "answers.lastTs")
    };
    if (entry.tries !== entry.ok + entry.wrong) fail("answers 的作答次数");
    if (questionId(qid, "answers 的题号")) data.answers[qid] = entry;
  }
  for (const [qid, value] of Object.entries(object(raw.wrongBook === undefined ? {} : raw.wrongBook, "wrongBook"))) {
    const w = object(value, "wrongBook");
    const entry = {
      ts: timestamp(w.ts, "wrongBook.ts"), count: number(w.count, "wrongBook.count"),
      mastered: bool(w.mastered, "wrongBook.mastered")
    };
    if (questionId(qid, "wrongBook 的题号")) data.wrongBook[qid] = entry;
  }
  if (raw.attempts !== undefined && !Array.isArray(raw.attempts)) fail("attempts");
  for (const value of raw.attempts ?? []) {
    const a = object(value, "attempts");
    const entry = {
      qid: a.qid, ok: bool(a.ok, "attempts.ok"), ts: timestamp(a.ts, "attempts.ts"),
      mode: mode(a.mode, "attempts.mode")
    };
    if (questionId(a.qid, "attempts.qid")) data.attempts.push(entry);
  }
  data.attempts = data.attempts.slice(-3000);
  if (raw.sessions !== undefined && !Array.isArray(raw.sessions)) fail("sessions");
  for (const value of raw.sessions ?? []) {
    const s = object(value, "sessions");
    const entry = {
      mode: mode(s.mode, "sessions.mode"), title: text(s.title, "sessions.title"),
      total: number(s.total, "sessions.total"), correct: number(s.correct, "sessions.correct"),
      pct: number(s.pct, "sessions.pct", 100, false), durSec: number(s.durSec, "sessions.durSec"),
      ts: timestamp(s.ts, "sessions.ts"), stars: s.stars == null ? null : number(s.stars, "sessions.stars", 3)
    };
    if (entry.correct > entry.total) fail("sessions.correct");
    if (entry.pct !== (entry.total ? Math.round(100 * entry.correct / entry.total) : 0)) fail("sessions.pct");
    data.sessions.push(entry);
  }
  for (const [id, value] of Object.entries(object(raw.levels === undefined ? {} : raw.levels, "levels"))) {
    if (!/^lv[1-9]\d{0,2}$/.test(id)) fail("levels 的关卡编号");
    const l = object(value, "levels");
    data.levels[id] = {
      stars: number(l.stars, "levels.stars", 3), bestPct: number(l.bestPct, "levels.bestPct", 100, false),
      plays: number(l.plays, "levels.plays")
    };
  }
  for (const [key, value] of Object.entries(object(raw.days === undefined ? {} : raw.days, "days"))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(key + "T12:00:00Z"))
      || new Date(key + "T12:00:00Z").toISOString().slice(0, 10) !== key) fail("days 的日期");
    data.days[key] = number(value, "days 的作答次数");
  }
  if (raw.theme !== undefined && !["light", "dark"].includes(raw.theme)) fail("theme");
  data.theme = raw.theme ?? "light";
  return { data, ignoredIds: [...ignoredIds] };
}

const Store = {
  KEY: "mayuan.study.v1",
  data: null,
  persisted: true,
  notice: "",
  defaults() {
    return {
      answers: Object.create(null),   // qid -> {tries, ok, wrong, lastOk, lastTs}
      wrongBook: Object.create(null), // qid -> {ts, count, mastered}
      attempts: [],  // [{qid, ok, ts, mode}] 封顶 3000 条
      sessions: [],  // [{mode,title,total,correct,pct,durSec,ts,stars?}]
      levels: Object.create(null),    // 关卡 id -> {stars, bestPct, plays}
      days: Object.create(null),      // 'YYYY-MM-DD' -> 当日做题数
      theme: "light"
    };
  },
  normalize: normalizeStudyData,
  showNotice(message = "") {
    this.notice = message;
    const notice = $("#storageNotice");
    if (notice) { notice.textContent = message; notice.hidden = !message; }
  },
  unsaved() {
    this.persisted = false;
    this.showNotice("学习记录尚未持久保存，关闭页面后可能丢失。可继续学习，请及时到「成绩分析」导出备份。");
  },
  load() {
    this.data = this.defaults();
    let raw;
    try {
      raw = localStorage.getItem(this.KEY);
    } catch { this.unsaved(); return this.data; }
    try {
      if (raw !== null) this.data = this.normalize(JSON.parse(raw)).data;
      this.persisted = true; this.showNotice();
    } catch {
      this.persisted = false;
      this.showNotice("浏览器中的学习存档无法读取，本次以空记录开始。请到「成绩分析」导入已有备份，并及时导出本次学习记录。");
    }
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.data));
      this.persisted = true; this.showNotice(); return true;
    } catch { this.unsaved(); return false; }
  },
  replace(raw) {
    this.data = this.normalize(raw, { requireComplete: true }).data;
    return this.save();
  },
  reset() {
    const theme = this.data?.theme || "light";
    this.data = this.defaults(); this.data.theme = theme;
    return this.save();
  },

  /** 记录一次作答。ok: boolean; mode: practice/exam/wrong */
  recordAnswer(qid, ok, mode) {
    const d = this.data;
    const a = d.answers[qid] || (d.answers[qid] = { tries: 0, ok: 0, wrong: 0, lastOk: false, lastTs: 0 });
    a.tries++; a.lastOk = ok; a.lastTs = Date.now();
    ok ? a.ok++ : a.wrong++;
    d.attempts.push({ qid, ok, ts: Date.now(), mode });
    if (d.attempts.length > 3000) d.attempts = d.attempts.slice(-3000);
    const k = dayKey();
    d.days[k] = (d.days[k] || 0) + 1;
    // 错题本联动：答错入册/加计数；答对若在册则标记可“掌握”
    if (!ok) {
      const w = d.wrongBook[qid] || (d.wrongBook[qid] = { ts: 0, count: 0, mastered: false });
      if (!w.ts) w.ts = Date.now();
      w.count++; w.mastered = false;
    }
    this.save();
  },
  markMastered(qid, mastered = true) {
    if (this.data.wrongBook[qid]) { this.data.wrongBook[qid].mastered = mastered; this.save(); }
  },
  removeWrong(qid) { delete this.data.wrongBook[qid]; this.save(); },
  addSession(s) { this.data.sessions.push(s); this.save(); },
  saveLevel(id, result) {
    const cur = this.data.levels[id] || { stars: 0, bestPct: 0, plays: 0 };
    cur.plays++;
    cur.stars = Math.max(cur.stars, result.stars);
    cur.bestPct = Math.max(cur.bestPct, result.pct);
    this.data.levels[id] = cur;
    this.save();
  },
  /** 连续学习天数（以今天为终点向前数） */
  streak() {
    let n = 0, t = Date.now();
    if (!this.data.days[dayKey(t)]) t -= 86400000; // 今天没学则从昨天算
    while (this.data.days[dayKey(t)] > 0) { n++; t -= 86400000; }
    return n;
  }
};

/* ---------------- 数据层 DB ---------------- */
const DB = {
  questions: [], subjective: [], chapters: null, banks: [],
  byId: Object.create(null),
  async load() {
    let data = window.MAYUAN_DATA;
    if (!data) {
      if (location.protocol === "file:") {
        throw new Error("未找到内置离线资料。请保留 data/offline-data.js 并重新打开完整的 Web/index.html，或使用 Offline 文件夹中的单文件成品。");
      }
      const [questions, subjective, chapters, banks] = await Promise.all([
        "data/questions.json", "data/subjective.json", "data/chapters.json", "data/banks.json"
      ].map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`无法读取学习资料（HTTP ${response.status}）。`);
        return response.json();
      }));
      data = { questions, subjective, chapters, banks };
    }
    const { questions: q, subjective: s, chapters: c, banks: b } = data;
    if (!Array.isArray(q) || !q.length || !Array.isArray(s) || !isStudyObject(c) || !Array.isArray(b)
      || q.some(item => !isStudyObject(item) || typeof item.id !== "string")
      || new Set(q.map(item => item.id)).size !== q.length) {
      throw new Error("学习资料不完整，请重新打开完整的离线文件。");
    }
    this.questions = q; this.subjective = s; this.chapters = c; this.banks = b;
    this.byId = Object.assign(Object.create(null), Object.fromEntries(q.map(x => [x.id, x])));
  },
  ofBank(bankId) { return this.questions.filter(q => q.bank === bankId); },
  ofKaoyanSection(keywords) {
    const ks = Array.isArray(keywords) ? keywords : [keywords];
    return this.questions.filter(q =>
      q.bank === "kaoyan" && ks.some(k =>
        (q.section || "").includes(k) || (q.part || "").includes(k)));
  }
};

/** 万能选题器：{banks, kySections, tag, random} → 题目数组（供练习/闯关/针对训练共用） */
function pickQuestions(filter = {}) {
  let pool = [];
  if (filter.banks) pool = DB.questions.filter(q => filter.banks.includes(q.bank));
  else if (filter.kySections) pool = DB.ofKaoyanSection(filter.kySections);
  else pool = [...DB.questions];
  if (filter.tag) pool = pool.filter(q => (q.tags || []).some(t => t.includes(filter.tag)));
  if (filter.random && pool.length > filter.random) pool = shuffle(pool).slice(0, filter.random);
  return pool;
}

/* ---------------- 路由 ---------------- */
const Views = {}; // 各模块注册：Views.xxx = (params) => html 或渲染函数
function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, query] = hash.split("?");
  const params = Object.fromEntries(new URLSearchParams(query || ""));
  const view = Views[name || "home"] || Views.home;
  Views.map?.cleanup?.();
  $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === (name || "")));
  $("#view").innerHTML = "";
  $("#view").scrollTo?.(0, 0); window.scrollTo(0, 0);
  view(params);
}

/* ================= 首页 ================= */
Views.home = function () {
  const d = Store.data;
  const totalDone = d.attempts.length;
  const totalOk = d.attempts.filter(a => a.ok).length;
  const pct = totalDone ? Math.round(100 * totalOk / totalDone) : 0;
  const stars = Object.values(d.levels).reduce((s, l) => s + l.stars, 0);
  const wrongActive = Object.values(d.wrongBook).filter(w => !w.mastered).length;

  // 下一关提示
  const nextLevel = (typeof LEVELS !== "undefined")
    ? LEVELS.find(l => !((d.levels[l.id] || {}).stars > 0)) : null;

  $("#view").innerHTML = `
  <section class="hero">
    <img class="hero-portrait" src="${escapeHtml(PORTRAIT_SRC)}" alt="马克思与恩格斯版画素描像">
    <div>
      <div class="hero-badges">
        <span>☰ 完整知识树</span><span>✎ ${DB.questions.length} 道客观题</span><span>⚑ 10 大关卡</span><span>▤ 存档可备份</span>
      </div>
      <h1>学马原，如<em>闯关修行</em></h1>
      <p class="slogan">以思维导图为纲，以题库练习为目；纲举目张，错题归仓，成绩有析。</p>
      <div class="hero-actions">
        <a class="btn primary" href="#/challenge">⚑ 开始闯关</a>
        <a class="btn" href="#/map">思维导图</a>
        <a class="btn" href="#/practice">顺序刷题</a>
        <a class="btn gold" href="#/about">使用说明</a>
      </div>
      <p class="hero-quote">哲学家们只是用不同的方式<em>解释世界</em>，而问题在于<em>改变世界</em>。<span>—— 马克思《关于费尔巴哈的提纲》第十一条</span></p>
    </div>
    <div class="stat-strip">
      <div class="stat-tile"><span class="ic">☀</span><div class="num">${Store.streak()}</div><div class="lbl">连续学习(天)</div></div>
      <div class="stat-tile"><span class="ic">✎</span><div class="num">${totalDone}</div><div class="lbl">累计作答(题)</div></div>
      <div class="stat-tile"><span class="ic">◎</span><div class="num">${pct}%</div><div class="lbl">总正确率</div></div>
      <div class="stat-tile"><span class="ic">★</span><div class="num">${stars}</div><div class="lbl">闯关星星</div></div>
    </div>
  </section>

  <h2 class="section-title">继续学习 <small>CONTINUE</small></h2>
  <div class="next-actions">
    <div class="feature-card">
      <div class="fi" style="background:var(--red-soft)">⚑</div>
      <h3>${nextLevel ? `下一关：${escapeHtml(nextLevel.name)}` : "全部关卡已通关！"}</h3>
      <p>${nextLevel ? escapeHtml(nextLevel.sub) : "可以回到关卡地图冲击满星，或去终极挑战刷新纪录。"}</p>
      <a class="go" href="#/challenge">前往闯关 →</a>
    </div>
    <div class="feature-card">
      <div class="fi" style="background:var(--gold-soft)">✎</div>
      <h3>错题待攻克：${wrongActive} 道</h3>
      <p>${wrongActive ? "错题不过夜，重练一遍即可标记“已掌握”。" : "错题本空空如也，去刷几组题检验一下吧。"}</p>
      <a class="go" href="#/wrong">打开错题本 →</a>
    </div>
    <div class="feature-card">
      <div class="fi" style="background:var(--green-soft)">☰</div>
      <h3>知识体系思维导图</h3>
      <p>完整保留课程笔记的章节与层级，可搜索知识点、展开分支，并从源笔记跳到关联练习。</p>
      <a class="go" href="#/map">打开导图 →</a>
    </div>
  </div>

  <h2 class="section-title">功能矩阵 <small>FEATURES</small></h2>
  <div class="feature-grid">
    ${[
      ["map", "❖", "思维导图", "完整知识树支持搜索与折叠，逐节点阅读源笔记，联动关联题目复习。", "var(--red-soft)"],
      ["practice", "✎", "顺序刷题", "五大题库顺序/随机练习，即时判分，逐题附详细解析。", "var(--blue-soft)"],
      ["challenge", "⚑", "闯关模式", "十大关卡递进解锁，60/85/100 分线对应一至三星。", "var(--gold-soft)"],
      ["wrong", "☒", "错题本", "答错自动归集，支持按题库筛选、重练与“已掌握”标记。", "var(--red-soft)"],
      ["stats", "▤", "成绩分析", "作答趋势、题库与题型正确率、薄弱知识点一网打尽。", "var(--green-soft)"],
      ["subjective", "✦", "主观题精讲", "简答/辨析/论述附参考答案与评分要点，自评掌握度。", "var(--blue-soft)"],
    ].map(([r, i, t, p, bg]) => `
      <a class="feature-card" href="#/${r}">
        <div class="fi" style="background:${bg}">${i}</div>
        <h3>${t}</h3><p>${p}</p><span class="go">进入 →</span>
      </a>`).join("")}
  </div>`;
};

/* ================= 顺序刷题（选题页） ================= */
Views.practice = function (params) {
  const groups = [...new Set(DB.banks.map(b => b.group))];
  const d = Store.data;
  function bankStats(bank) {
    const qs = DB.ofBank(bank.id);
    const done = qs.filter(q => d.answers[q.id]);
    const ok = done.filter(q => d.answers[q.id].lastOk);
    return { total: qs.length, done: done.length, pct: done.length ? Math.round(100 * ok.length / done.length) : 0 };
  }
  // 考研分章（练习入口）
  const kySecs = [...new Set(DB.questions.filter(q => q.bank === "kaoyan").map(q => q.section))];

  $("#view").innerHTML = `
    <h2 class="section-title">顺序刷题 <small>PRACTICE</small></h2>
    ${groups.map(g => `
      <h3 style="font-size:15px;color:var(--mut);margin:20px 0 10px">${g}</h3>
      <div class="bank-grid">
        ${DB.banks.filter(b => b.group === g).map(b => {
          const st = bankStats(b);
          return `
          <div class="card bank-card">
            <h3>${escapeHtml(b.name)}</h3>
            <p class="desc">${escapeHtml(b.desc)}</p>
            <div class="bank-meta">
              <span class="chip">共 ${st.total} 题</span>
              <span class="chip">已练 ${st.done}</span>
              <span class="chip">最近正确率 ${st.pct}%</span>
            </div>
            <div class="progressline"><i style="width:${st.total ? 100 * st.done / st.total : 0}%"></i></div>
            <div class="bank-actions">
              <button class="btn primary small" data-bank="${b.id}" data-mode="seq">顺序练习</button>
              <button class="btn small" data-bank="${b.id}" data-mode="rand">随机练习</button>
            </div>
          </div>`;
        }).join("")}
      </div>`).join("")}

    <h2 class="section-title">考研分章专练 <small>BY SECTION</small></h2>
    <div class="card">
      <div class="bank-meta" id="kySecChips">
        ${kySecs.map(s => `<button class="btn small" data-sec="${escapeHtml(s)}">${escapeHtml(s.replace(/　/g, " "))}</button>`).join("")}
      </div>
      <p class="muted" style="font-size:12.5px">点击章节开始该章真题练习（单选 + 多选，含解析）。</p>
    </div>`;

  $$("#view [data-bank]").forEach(btn => btn.onclick = () => {
    const qs = DB.ofBank(btn.dataset.bank);
    const list = btn.dataset.mode === "rand" ? shuffle(qs) : qs;
    const bank = DB.banks.find(b => b.id === btn.dataset.bank);
    startQuiz({ title: bank.name, questions: list, mode: "practice", back: "#/practice" });
  });
  $$("#kySecChips [data-sec]").forEach(btn => btn.onclick = () => {
    const qs = DB.ofKaoyanSection(btn.dataset.sec);
    startQuiz({ title: "考研 · " + btn.dataset.sec, questions: qs, mode: "practice", back: "#/practice" });
  });
};

/* ================= 主观题 ================= */
Views.subjective = function () {
  const kinds = [...new Set(DB.subjective.map(s => s.kind))];
  const doneIds = new Set(Object.keys(Store.data.answers));
  $("#view").innerHTML = `
    <h2 class="section-title">主观题精讲 <small>SUBJECTIVE · 自评模式</small></h2>
    <p class="muted" style="margin-top:-6px">先遮挡答案自行作答，再展开参考答案核对；按实际掌握情况自评，「还需努力」会自动收入错题本。</p>
    ${kinds.map(k => `
      <h3 style="font-size:15px;color:var(--mut);margin:18px 0 10px">${k}</h3>
      <div class="subj-list">
      ${DB.subjective.filter(s => s.kind === k).map(s => `
        <div class="card subj-card" id="${s.id}">
          <div class="q-head">
            <span class="tag gold">${s.kind} · ${s.score}分</span>
            <span class="muted" style="font-size:12px">${escapeHtml(s.origin || "")}</span>
            ${doneIds.has("S:" + s.id) ? '<span class="tag green">已自评</span>' : ""}
          </div>
          <h3 style="font-size:15.5px;font-family:var(--font-body)">${escapeHtml(s.title)}</h3>
          ${s.prompt ? `<div class="prompt">${mdLite(s.prompt)}</div>` : ""}
          <button class="btn small primary" onclick="this.closest('.subj-card').classList.toggle('open')">
            显示 / 隐藏参考答案</button>
          <div class="ref">
            <h4 style="color:var(--gold);font-size:13px;letter-spacing:2px">参考答案</h4>
            ${mdLite(s.reference)}
            ${s.rubric ? `<h4 style="color:var(--gold);font-size:13px;letter-spacing:2px;margin-top:12px">评分要点 / 思路点拨</h4>${mdLite(s.rubric)}` : ""}
            <div class="self-grade">
              <button class="btn small" data-grade="ok" data-id="${s.id}">✓ 我掌握了</button>
              <button class="btn small" data-grade="no" data-id="${s.id}">✗ 还需努力</button>
            </div>
          </div>
        </div>`).join("")}
      </div>`).join("")}`;

  $$("#view [data-grade]").forEach(btn => btn.onclick = () => {
    const key = "S:" + btn.dataset.id;
    const ok = btn.dataset.grade === "ok";
    Store.recordAnswer(key, ok, "subjective"); // 答错会自动入册（见 Store.recordAnswer）
    if (!ok) {
      toast("已收入错题本，稍后去攻克它");
    } else {
      Store.removeWrong(key);
      toast("已标记掌握");
    }
    Views.subjective();
  });
};

/* ================= 使用说明 ================= */
Views.about = function () {
  $("#view").innerHTML = `
  <h2 class="section-title">使用说明 <small>OFFLINE STUDY</small></h2>
  <div class="card" style="font-size:14.5px;line-height:1.9">
    <h3>双击即学，离线可用</h3>
    <p>双击 Web 文件夹中的 index.html 即可开始学习；也可以打开 Offline 文件夹中的单文件成品。
    两种方式都无需联网。先用思维导图梳理完整知识树，搜索薄弱概念、阅读源笔记，再进入关联题目检验掌握情况。</p>
    <h3>保存与迁移学习记录</h3>
    <p>学习记录保存在当前浏览器中。换浏览器、移动文件或清理浏览器数据前，请到「成绩分析」导出 JSON 备份；
    在新页面导入备份即可恢复。导入会覆盖当前学习记录，请先保存需要保留的进度。
    若页面提示记录尚未保存，仍可继续学习，但关闭前务必导出备份。</p>
    <p>资料包含课堂小测、考研真题精选及 2024 秋期末回忆卷。期末回忆资料可能与原卷存在差异，供公益复习参考，禁止售卖。</p>
    <div class="bank-meta" style="margin-top:14px">
      <span class="tag red" style="font-size:12px">双击打开 · 离线学习</span>
      <span class="tag gold" style="font-size:12px">学习存档可导入 / 导出</span>
      <span class="tag green" style="font-size:12px">亮暗双主题</span>
      <span class="tag blue" style="font-size:12px">${DB.questions.length} 客观题 + ${DB.subjective.length} 主观题</span>
    </div>
  </div>`;
};

/* ---------------- 启动 ---------------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
}
async function boot() {
  Store.load();
  applyTheme(Store.data.theme);
  $("#themeToggle").onclick = () => {
    Store.data.theme = Store.data.theme === "dark" ? "light" : "dark";
    Store.save(); applyTheme(Store.data.theme);
  };
  await DB.load();
  window.addEventListener("hashchange", route);
  document.addEventListener("click", event => {
    const link = event.target.closest?.("a[href^='#/']");
    if (link && link.getAttribute("href") === location.hash && !event.defaultPrevented
      && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); route();
    }
  });
  route();
}
function startApp() {
  boot().catch(e => {
    $("#view").innerHTML = `<div class="empty" role="alert">数据加载失败：${escapeHtml(e.message)}<br>
      请重新打开完整的离线文件；资料齐全时，直接双击即可使用。</div>`;
  });
}
// 必须等后续业务脚本注册 Views 后再路由，内置资料无需 fetch 也能正确启动。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}

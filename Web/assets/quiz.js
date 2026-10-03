/* ============================================================
   quiz.js — 答题引擎
   两种模式：
   - practice 练习模式：单题作答立即判分，逐题阅读解析
   - exam    考试模式（闯关/模拟）：答题卡跳转，交卷统一出分
   产出结果 {total, correct, pct, durSec} 供调用方（如闯关）定级。
   作答行为统一写入 Store（见 DOCUMENTATION.md 存档结构）。
   ============================================================ */
"use strict";

/**
 * startQuiz({title, questions, mode, back, onFinish})
 *  - questions: 题目对象数组（DB.questions 的子集，允许乱序）
 *  - onFinish(result): 考试模式下交卷后回调；练习模式在结束时回调
 */
function startQuiz({ title, questions, mode = "practice", back = "#/", onFinish = null }) {
  if (!questions.length) { toast("该范围内暂无题目"); return; }
  const view = $("#view");
  const state = {
    i: 0,
    picks: questions.map(() => []),   // 每题已选字母
    locked: questions.map(() => false), // practice 模式：是否已判分
    startTs: Date.now(),
    finished: false,
  };

  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const isRight = idx => sameSet(state.picks[idx], questions[idx].answer);

  function shell(inner) {
    view.innerHTML = `
      <div class="quiz-shell">
        <div class="quiz-topbar">
          <a class="btn small" href="${back}">‹ 返回</a>
          <strong style="font-size:14.5px">${escapeHtml(title)}</strong>
          <span class="chip" id="qPos"></span>
          <div class="quiz-progress"><i id="qBar"></i></div>
        </div>
        ${inner}
      </div>`;
  }

  /* ---------- practice 模式 ---------- */
  function renderPractice() {
    const q = questions[state.i];
    const picked = state.picks[state.i];
    const locked = state.locked[state.i];
    shell(`
      <div class="q-card">
        <div class="q-head">
          <span class="tag red">${TYPE_NAME[q.type]}</span>
          <span class="muted" style="font-size:12px">${escapeHtml(q.origin || q.bankName)}</span>
        </div>
        <div class="q-stem">${mdLite(q.stem)}</div>
        <div id="opts">
          ${q.options.map(o => `
            <button class="opt" data-key="${o.key}">
              <span class="key">${o.key}</span><span>${mdLite(o.text)}</span>
            </button>`).join("")}
        </div>
        <div id="fb"></div>
        <div class="q-actions">
          <button class="btn" id="prevQ" ${state.i === 0 ? "disabled" : ""}>‹ 上一题</button>
          <div>
            ${!locked && q.type === "multi" ? '<button class="btn primary" id="submitPick">提交答案</button>' : ""}
            ${locked
              ? (state.i === questions.length - 1
                  ? '<button class="btn primary" id="finishQ">查看成绩 ✓</button>'
                  : '<button class="btn primary" id="nextQ">下一题 ›</button>')
              : '<span class="muted" style="font-size:12px">' + (q.type === "multi" ? "多选题：选完后点提交" : "点击选项作答") + "</span>"}
          </div>
        </div>
      </div>`);

    $("#qPos").textContent = `第 ${state.i + 1} / ${questions.length} 题`;
    $("#qBar").style.width = `${100 * (state.i + 1) / questions.length}%`;

    const optBtns = $$("#opts .opt");
    function paint() {
      optBtns.forEach(b => {
        const k = b.dataset.key;
        b.classList.toggle("sel", picked.includes(k));
        if (locked) {
          b.disabled = true;
          if (q.answer.includes(k)) b.classList.add("right");
          else if (picked.includes(k)) b.classList.add("wrong-pick");
        }
      });
    }
    function judge() {
      state.locked[state.i] = true;
      const ok = isRight(state.i);
      Store.recordAnswer(q.id, ok, "practice");
      if (!ok) toast("已记入错题本");
      $("#fb").innerHTML = `
        <div class="q-feedback ${ok ? "ok" : "bad"}">
          <strong>${ok ? "✓ 回答正确" : "✗ 回答错误"}</strong>
          <span class="muted" style="margin-left:10px">正确答案：${q.answer.join("、")}</span>
        </div>
        <div class="q-analysis"><h4>解 析</h4>${mdLite(q.analysis || "（本题暂无解析）")}</div>`;
      paint();
      // 切换底部按钮
      const act = $(".q-actions div");
      act.innerHTML = state.i === questions.length - 1
        ? '<button class="btn primary" id="finishQ">查看成绩 ✓</button>'
        : '<button class="btn primary" id="nextQ">下一题 ›</button>';
      bindNav();
    }
    optBtns.forEach(b => b.onclick = () => {
      if (state.locked[state.i]) return;
      const k = b.dataset.key;
      if (q.type === "multi") {
        const p = picked.indexOf(k);
        p > -1 ? picked.splice(p, 1) : picked.push(k);
        paint();
      } else {
        state.picks[state.i] = [k];
        judge();
      }
    });
    function bindNav() {
      $("#prevQ")?.addEventListener("click", () => { state.i--; renderPractice(); });
      $("#nextQ")?.addEventListener("click", () => { state.i++; renderPractice(); });
      $("#finishQ")?.addEventListener("click", finish);
      $("#submitPick")?.addEventListener("click", () => {
        if (!state.picks[state.i].length) { toast("请先选择答案"); return; }
        judge();
      });
    }
    bindNav();
    if (locked) { // 回看已判分的题
      judge_noRecord();
    }
    function judge_noRecord() {
      paint();
      $("#fb").innerHTML = `
        <div class="q-feedback ${isRight(state.i) ? "ok" : "bad"}">
          <strong>${isRight(state.i) ? "✓ 回答正确" : "✗ 回答错误"}</strong>
          <span class="muted" style="margin-left:10px">正确答案：${q.answer.join("、")}</span>
        </div>
        <div class="q-analysis"><h4>解 析</h4>${mdLite(q.analysis || "（本题暂无解析）")}</div>`;
    }
  }

  /* ---------- exam 模式 ---------- */
  function renderExam() {
    const q = questions[state.i];
    const picked = state.picks[state.i];
    const answered = state.picks.filter(p => p.length).length;
    shell(`
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span class="muted" style="font-size:12.5px">已答 ${answered} / ${questions.length}（点击题号跳转）</span>
          <button class="btn primary small" id="handin">交 卷</button>
        </div>
        <div class="answer-sheet">
          ${questions.map((_, i) => `
            <button data-jump="${i}" class="${state.picks[i].length ? "done" : ""} ${i === state.i ? "cur" : ""}">${i + 1}</button>`).join("")}
        </div>
      </div>
      <div class="q-card">
        <div class="q-head">
          <span class="tag red">${TYPE_NAME[q.type]}</span>
          <span class="muted" style="font-size:12px">${escapeHtml(q.origin || q.bankName)}</span>
        </div>
        <div class="q-stem">${mdLite(q.stem)}</div>
        ${q.options.map(o => `
          <button class="opt ${picked.includes(o.key) ? "sel" : ""}" data-key="${o.key}">
            <span class="key">${o.key}</span><span>${mdLite(o.text)}</span>
          </button>`).join("")}
        <div class="q-actions">
          <button class="btn" id="prevQ" ${state.i === 0 ? "disabled" : ""}>‹ 上一题</button>
          <span class="muted" style="font-size:12px">${q.type === "multi" ? "多选题" : ""}</span>
          <button class="btn" id="nextQ" ${state.i === questions.length - 1 ? "disabled" : ""}>下一题 ›</button>
        </div>
      </div>`);

    $("#qPos").textContent = `第 ${state.i + 1} / ${questions.length} 题`;
    $("#qBar").style.width = `${100 * answered / questions.length}%`;

    $$("[data-jump]").forEach(b => b.onclick = () => { state.i = +b.dataset.jump; renderExam(); });
    $$(".opt").forEach(b => b.onclick = () => {
      const k = b.dataset.key;
      if (q.type === "multi") {
        const p = picked.indexOf(k);
        p > -1 ? picked.splice(p, 1) : picked.push(k);
      } else state.picks[state.i] = [k];
      renderExam();
    });
    $("#prevQ").onclick = () => { state.i--; renderExam(); };
    $("#nextQ").onclick = () => { state.i++; renderExam(); };
    $("#handin").onclick = () => {
      const un = questions.length - answered;
      if (un > 0 && !confirm(`还有 ${un} 题未作答，确定交卷？（未答按错误计）`)) return;
      finish();
    };
  }

  /* ---------- 结算 ---------- */
  function finish() {
    if (state.finished) return;
    state.finished = true;
    const durSec = Math.max(1, Math.round((Date.now() - state.startTs) / 1000));
    let correct = 0;
    questions.forEach((q, i) => {
      const ok = isRight(i);
      if (ok) correct++;
      if (mode === "exam") Store.recordAnswer(q.id, ok, "exam"); // practice 已逐题记录
    });
    const pct = Math.round(100 * correct / questions.length);
    const result = { total: questions.length, correct, pct, durSec };
    const extra = onFinish ? onFinish(result) : null; // 闯关回调星级等
    Store.addSession({
      mode, title, total: result.total, correct, pct, durSec,
      ts: Date.now(), stars: extra?.stars ?? null,
    });

    const dash = 2 * Math.PI * 52;
    shell(`
      <div class="card score-hero">
        <svg class="score-ring" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--bg-2)" stroke-width="10"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="${pct >= 60 ? "var(--red)" : "var(--mut)"}"
            stroke-width="10" stroke-linecap="round" transform="rotate(-90 60 60)"
            stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - pct / 100)}"/>
          <text x="60" y="58" text-anchor="middle" class="pct" fill="var(--ink)" font-size="26" font-weight="800">${pct}%</text>
          <text x="60" y="78" text-anchor="middle" fill="var(--mut)" font-size="11">正确率</text>
        </svg>
        ${extra?.stars != null
          ? `<div class="stars">${[1, 2, 3].map(n => `<span class="${n <= extra.stars ? "" : "off"}">★</span>`).join("")}</div>`
          : ""}
        ${extra?.message ? `<p class="muted">${escapeHtml(extra.message)}</p>` : ""}
        <p style="font-size:15px">共 ${result.total} 题 · 答对 <strong style="color:var(--green)">${correct}</strong> ·
           答错 <strong style="color:var(--red)">${result.total - correct}</strong> · 用时 ${fmtDur(durSec)}</p>
        <div class="bank-actions" style="justify-content:center">
          <button class="btn" id="reviewWrong">回顾错题 (${result.total - correct})</button>
          <button class="btn" id="reviewAll">全部回顾</button>
          <a class="btn primary" href="${back}">完成，返回</a>
        </div>
      </div>
      <div id="reviewZone"></div>`);
    $("#qPos").textContent = "已交卷";
    $("#qBar").style.width = "100%";

    const renderReview = onlyWrong => {
      const items = questions.map((q, i) => ({ q, i, ok: isRight(i) }))
        .filter(x => !onlyWrong || !x.ok);
      $("#reviewZone").innerHTML = items.length ? items.map(({ q, i, ok }) => `
        <div class="card q-card" style="margin-top:14px">
          <div class="q-head">
            <span class="tag ${ok ? "green" : "red"}">第${i + 1}题 · ${ok ? "正确" : "错误"}</span>
            <span class="tag blue">${TYPE_NAME[q.type]}</span>
            <span class="muted" style="font-size:12px">${escapeHtml(q.origin || "")}</span>
          </div>
          <div class="q-stem">${mdLite(q.stem)}</div>
          ${q.options.map(o => {
            const pick = state.picks[i].includes(o.key);
            const cls = q.answer.includes(o.key) ? "right" : (pick ? "wrong-pick" : "");
            return `<button class="opt ${cls}" disabled><span class="key">${o.key}</span><span>${mdLite(o.text)}</span></button>`;
          }).join("")}
          <div class="q-feedback ${ok ? "ok" : "bad"}">
            你的作答：${state.picks[i].join("、") || "（未答）"}　正确答案：${q.answer.join("、")}
          </div>
          <div class="q-analysis"><h4>解 析</h4>${mdLite(q.analysis || "（本题暂无解析）")}</div>
        </div>`).join("")
        : '<div class="empty" style="margin-top:14px">没有错题，满分通过！</div>';
      $("#reviewZone").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("#reviewWrong").onclick = () => renderReview(true);
    $("#reviewAll").onclick = () => renderReview(false);
  }

  (mode === "exam" ? renderExam : renderPractice)();
}

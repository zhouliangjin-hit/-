/* Run from any directory: node Web/tools/test_runtime.js
   No dependencies. This checks the real runtime scripts with a small browser
   stub; it does not reproduce the quiz or mindmap DOM. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const webRoot = path.resolve(__dirname, "..");
const listeners = new Map();
const nodes = new Map([
  [".ink-watermark", { getAttribute: () => "assets/marx-engels.png" }],
  ["#themeToggle", {}],
  ["#storageNotice", { textContent: "", hidden: true }],
  ["#view", { innerHTML: "", scrollTo() {} }]
]);
const persisted = new Map();
let blockReads = false;
let blockWrites = false;
let fetchCalls = 0;

const context = vm.createContext({
  assert,
  URLSearchParams,
  location: { protocol: "file:", hash: "#/map" },
  document: {
    readyState: "loading",
    documentElement: { dataset: {} },
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: () => [],
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    }
  },
  window: { addEventListener() {}, scrollTo() {} },
  localStorage: {
    getItem(key) {
      if (blockReads) throw new Error("Storage access denied");
      return persisted.get(key) ?? null;
    },
    setItem(key, value) {
      if (blockWrites) throw new Error("Storage quota exceeded");
      persisted.set(key, value);
    }
  },
  async fetch() {
    fetchCalls++;
    throw new Error("An embedded offline app must not fetch data");
  }
});

function run(source) {
  return vm.runInContext(source, context);
}

// Use a tiny dataset so this test remains independent of source-file changes.
run(`window.MAYUAN_DATA = {
  questions: [{id:"test-q1", bank:"test", type:"single"}],
  subjective: [{id:"test-s1"}],
  chapters: {id:"root", title:"知识树", notes:[], children:[]},
  banks: [{id:"test", name:"测试题库"}]
};`);
for (const filename of ["app.js", "stats.js"]) {
  vm.runInContext(fs.readFileSync(path.join(webRoot, "assets", filename), "utf8"), context, { filename });
}

async function main() {
  assert.equal(run("Store.data"), null, "Store must not boot before DOMContentLoaded");
  assert.equal(fetchCalls, 0);
  assert.equal(listeners.get("DOMContentLoaded")?.length, 1);

  // Simulate a business module registering its route after app.js has loaded.
  run(`let mapCalls = 0;
    Views.map = () => { mapCalls++; };
  `);
  listeners.get("DOMContentLoaded")[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run("mapCalls"), 1, "A direct #/map URL must use the registered module");
  assert.equal(run("DB.questions.length"), 1);
  assert.equal(fetchCalls, 0, "Embedded data must work without fetch");

  run(`
    Store.recordAnswer("test-q1", false, "practice");
    Store.recordAnswer("test-q1", true, "practice");
    Store.recordAnswer("S:test-s1", false, "subjective");
    Store.addSession({mode:"practice",title:"练习",total:2,correct:1,pct:50,durSec:3,ts:1,stars:null});
    Store.saveLevel("lv1", {stars:2,pct:85});
    const snapshot = JSON.stringify(Store.data);

    const legacy = parseLearningBackup(snapshot);
    assert.equal(JSON.stringify(legacy.data), snapshot, "Old bare Store.data backups must round-trip");
    const wrapped = parseLearningBackup(JSON.stringify({
      format:"mayuan.study.backup",version:1,exportedAt:new Date().toISOString(),data:Store.data
    }));
    assert.equal(JSON.stringify(wrapped.data), snapshot, "Versioned backups must round-trip");
    assert.equal(wrapped.data.answers["test-q1"].tries, 2);
    assert.equal(wrapped.data.wrongBook["S:test-s1"].count, 1);

    const oldQuestion = JSON.parse(snapshot);
    oldQuestion.answers["removed-q"] = {tries:1,ok:0,wrong:1,lastOk:false,lastTs:0};
    oldQuestion.wrongBook["removed-q"] = {ts:0,count:1,mastered:false};
    oldQuestion.attempts.push({qid:"removed-q",ok:false,ts:0,mode:"practice"});
    const filtered = parseLearningBackup(JSON.stringify(oldQuestion));
    assert.equal(filtered.ignoredIds.length, 1, "An unknown qid must be reported once");
    assert.equal(filtered.data.answers["removed-q"], undefined);
    assert.equal(filtered.data.wrongBook["removed-q"], undefined);
    assert.equal(filtered.data.attempts.length, 3);

    function rejectsChange(change) {
      const malformed = JSON.parse(snapshot);
      change(malformed);
      assert.throws(() => parseLearningBackup(JSON.stringify(malformed)));
      assert.equal(JSON.stringify(Store.data), snapshot, "Rejected data must not change current records");
    }
    rejectsChange(d => { d.answers = []; });
    rejectsChange(d => { d.answers = null; });
    rejectsChange(d => { d.attempts = {}; });
    rejectsChange(d => { d.answers["test-q1"].ok = -1; });
    rejectsChange(d => { d.answers["test-q1"].tries = 2.5; });
    rejectsChange(d => { d.answers["test-q1"].tries = 99; });
    rejectsChange(d => { d.answers["test-q1"].lastTs = 1e18; });
    rejectsChange(d => { d.wrongBook["test-q1"].mastered = "false"; });
    rejectsChange(d => { d.sessions[0].stars = 99; });
    rejectsChange(d => { d.sessions[0].pct = 101; });
    rejectsChange(d => { d.sessions[0].title = []; });
    rejectsChange(d => { d.levels.lv1.stars = 4; });
    rejectsChange(d => { d.days["2026-02-30"] = 1; });
    rejectsChange(d => { d.attempts[0].mode = "unknown"; });
    rejectsChange(d => { d.theme = "unknown"; });
    assert.throws(() => parseLearningBackup("{broken json}"));
    assert.throws(() => parseLearningBackup("[]"));
    assert.throws(() => parseLearningBackup("{}"));
    assert.throws(() => parseLearningBackup(JSON.stringify({format:"mayuan.study.backup",version:2,data:Store.data})));

    for (const dangerous of ["__proto__", "constructor", "prototype"]) {
      rejectsChange(d => {
        d.extra = JSON.parse('{"nested":{"' + dangerous + '":{"polluted":true}}}');
      });
    }
    assert.equal(({}).polluted, undefined, "Import validation must not pollute object prototypes");
  `);

  const diskSnapshot = persisted.get("mayuan.study.v1");
  blockWrites = true;
  run(`Store.recordAnswer("test-q1", false, "practice");
    Store.recordAnswer("test-q1", true, "practice");
    assert.equal(Store.data.answers["test-q1"].tries, 4);
    assert.equal(Store.data.attempts.length, 5);
    assert.equal(Store.persisted, false);
  `);
  assert.equal(persisted.get("mayuan.study.v1"), diskSnapshot);
  assert.equal(nodes.get("#storageNotice").hidden, false, "Unsaved progress needs a persistent notice");

  run("assert.equal(Store.reset(), false); assert.equal(Store.data.attempts.length, 0);");
  assert.equal(persisted.get("mayuan.study.v1"), diskSnapshot, "A failed reset must not reload stale data into memory");
  blockWrites = false;
  run("assert.equal(Store.save(), true); assert.equal(Store.persisted, true);");
  assert.equal(nodes.get("#storageNotice").hidden, true);

  blockReads = true;
  blockWrites = true;
  run(`Store.load();
    Store.recordAnswer("test-q1", true, "practice");
    assert.equal(Store.data.attempts.length, 1);
    assert.equal(Store.persisted, false);
  `);
  assert.equal(nodes.get("#storageNotice").hidden, false);

  console.log("PASS: deferred offline routing; old/new backup round trips; unknown qids; malformed and dangerous data rejection; storage failures preserve usable in-memory progress.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

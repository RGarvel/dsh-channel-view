/**
 * buildChannelState 纯函数回归测试（临时 fixture 注入 qqDir，不碰宿主）。
 * 运行：node --test test/buildChannelState.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChannelState } from "../lib/index.js";

function fixtureDir(prefs, peers) {
  const dir = mkdtempSync(join(tmpdir(), "dshcv-"));
  writeFileSync(join(dir, "model-prefs.json"), JSON.stringify(prefs));
  writeFileSync(join(dir, "session-peers.json"), JSON.stringify(peers));
  return dir;
}

test("冷会话经 cachedSnapshot 归类，subagent 与 unobserved 跳过", () => {
  const metas = [
    { id: "session-a", origin: undefined },
    { id: "session-b", origin: "subagent" },
    { id: "session-c" },
  ];
  const cache = {
    "session-a": { values: { qqChannel: "qq/c2c" } },
    "session-c": { values: { qqChannel: "unobserved" } },
  };
  const dir = fixtureDir({}, {});
  try {
    const s = buildChannelState({
      metas,
      cachedSnapshot: (m) => cache[m.id],
      liveOverlay: new Map(),
      qqDir: dir,
    });
    assert.deepEqual(s.channels, { "session-a": "qq/c2c" });
    assert.equal("session-b" in s.channels, false);
    assert.equal("session-c" in s.channels, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("live overlay 覆盖冷快照缺失项（core 丢锁存的补位）", () => {
  const dir = fixtureDir({}, {});
  try {
    const s = buildChannelState({
      metas: [{ id: "session-live" }, { id: "session-cold" }],
      cachedSnapshot: (m) => (m.id === "session-cold" ? { values: { qqChannel: "qq/group" } } : undefined),
      liveOverlay: new Map([["session-live", "qq/c2c"]]),
      qqDir: dir,
    });
    assert.equal(s.channels["session-live"], "qq/c2c");
    assert.equal(s.channels["session-cold"], "qq/group");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

);

test("bound = prefs.sessionIds ∪ peers 键，去重", () => {
  const dir = fixtureDir(
    { sessionIds: { "qqbot:1:c2c:X": "session-x", "qqbot:1:group:Y": "session-y" } },
    { "session-x": { scope: "c2c" }, "session-z": { scope: "group" } },
  );
  try {
    const s = buildChannelState({ metas: [], cachedSnapshot: () => undefined, liveOverlay: new Map(), qqDir: dir });
    assert.deepEqual([...s.bound].sort(), ["session-x", "session-y", "session-z"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("渠道权威来源 = session-peers.json 的 scope（不依赖 source.channel 戳）", () => {
  const dir = fixtureDir(
    { sessionIds: {} },
    {
      "session-qq-c2c": { scope: "c2c", peerId: "U1" },
      "session-qq-group": { scope: "group", peerId: "G1" },
    },
  );
  try {
    // metas 即便为空，peers 的 scope 也应直接给出渠道
    const s = buildChannelState({ metas: [], cachedSnapshot: () => undefined, liveOverlay: new Map(), qqDir: dir });
    assert.deepEqual(s.channels, {
      "session-qq-c2c": "qq/c2c",
      "session-qq-group": "qq/group",
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scope 权威优先级高于 qqChannel 投影锁存", () => {
  const dir = fixtureDir(
    {},
    { "session-x": { scope: "group" } },
  );
  try {
    const s = buildChannelState({
      metas: [{ id: "session-x" }],
      cachedSnapshot: () => ({ values: { qqChannel: "qq/c2c" } }),
      liveOverlay: new Map([["session-x", "qq/c2c"]]),
      qqDir: dir,
    });
    // peers scope=group 应覆盖投影单元给出的 c2c
    assert.equal(s.channels["session-x"], "qq/group");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("缺失/损坏文件降级为空，不抛", () => {
  const s = buildChannelState({
    metas: [{ id: "session-a" }],
    cachedSnapshot: () => { throw new Error("boom"); },
    liveOverlay: new Map(),
    qqDir: join(tmpdir(), "dshcv-does-not-exist-xyz"),
  });
  assert.deepEqual(s.channels, {});
  assert.deepEqual(s.bound, []);
});

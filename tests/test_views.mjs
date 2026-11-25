import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEWS,
  TREE_DIRECTIONS,
  normalizeTreeDirection,
  TREE_METRICS,
  JOB_COLORS,
  JOB_COLORS_DARK,
  DEFAULT_ICONS,
  PRESET_ICON_ASSETS,
  isStandardIconKey,
  isValidIconKey,
  isSafeIconSource,
  sanitizeSvgMarkup,
  sanitizeCustomIconsMap,
  jobIcon,
  jobIconPath,
  jobIconAsset,
  allJobIconOptions,
  projectIconKeys,
  parseDependsInput,
  visibleJobs,
  visibleWork,
  filterWork,
  activeFilterCount,
  hasActiveFilters,
  canDeleteTask,
  canPurgeTask,
  canDeleteProject,
  formatTimestamp,
  MODALS,
  parseRoute,
  routeUrl,
  workRows,
  projectSummary,
  timelineRows,
  filterTimelineRows,
  kanbanColumns,
  treeScene,
  edgePathD,
} from "../static/view-model.mjs";

const row = (id, objective, extra = {}, display = undefined) => ({
  record: { id, objective, status: "todo", ...extra },
  ...(display ? { display } : {}),
});

const snapshot = {
  project: row("prj-1", "Project", { name: "TTJWeb" }),
  tasks: [{
    task: row("tsk-1", "Task", { criteria: ["条件1", "条件2"], status: "doing" }),
    tickets: [
      { ticket: row("tkt-1", "Ticket 1", { status: "completed" }), jobs: [row("job-1", "Job 1", { status: "completed", runs: [{ id: "run-1" }] })] },
      { ticket: row("tkt-2", "Ticket 2", { status: "doing", depends: ["tkt-1", "tkt-external"] }), jobs: [row("job-2", "Job 2", { status: "doing" }, { icon: "github" })] },
    ],
  }],
};

// Rich graph designed to exercise fan-out junctions, fan-in merge junctions, and non-connecting crossings (bridges).
const richSnapshot = {
  project: row("prj-rich", "Rich Project", { name: "TTJWeb Rich" }),
  tasks: [
    {
      task: row("tsk-a", "設計と基盤構築", { criteria: ["API設計完了", "テスト通過"], status: "doing" }),
      tickets: [
        {
          ticket: row("tkt-a1", "要件整理", { status: "completed", worker_id: "wkr-1" }),
          jobs: [row("job-a1", "調査", { status: "completed" }, { icon: "search" })],
        },
        {
          ticket: row("tkt-a2", "スキーマ設計", { status: "completed", worker_id: "wkr-2" }),
          jobs: [row("job-a2", "定義", { status: "completed" }, { icon: "book" })],
        },
        {
          ticket: row("tkt-a3", "API実装（tkt-a2依存）", { status: "doing", worker_id: "wkr-1", depends: ["tkt-a2"] }),
          jobs: [row("job-a3", "実装", { status: "doing", runs: [{ id: "run-a3", active: true, progress: { percent: 65, message: "エンドポイント実装中" } }] }, { icon: "edit" })],
        },
        {
          ticket: row("tkt-a4", "UI統合（tkt-a1依存）", { status: "waiting", worker_id: "wkr-2", depends: ["tkt-a1"] }),
          jobs: [row("job-a4", "接続", { status: "waiting" }, { icon: "github" })],
        },
        {
          ticket: row("tkt-a5", "結合確認（a3・a4合流）", { status: "todo", worker_id: "wkr-1", depends: ["tkt-a3", "tkt-a4"] }),
          jobs: [row("job-a5", "E2E確認", { status: "todo" }, { icon: "test" })],
        },
      ],
    },
    {
      task: row("tsk-b", "リリース準備", { criteria: ["チェック完了"], status: "paused" }),
      tickets: [
        {
          ticket: row("tkt-b1", "性能計測", { status: "paused", worker_id: "wkr-2", depends: ["tkt-a1"] }),
          jobs: [row("job-b1", "計測", { status: "paused" }, { icon: "execute" })],
        },
        {
          ticket: row("tkt-b2", "セキュリティ確認", { status: "blocked", worker_id: "wkr-1", depends: ["tkt-a3"] }),
          jobs: [row("job-b2", "監査", { status: "blocked" }, { icon: "review" })],
        },
        {
          ticket: row("tkt-b3", "旧案の破棄", { status: "canceled", worker_id: "wkr-2" }),
          jobs: [row("job-b3", "片付け", { status: "canceled" })],
        },
      ],
    },
  ],
};

test("all four views preserve project and selection through query URLs and path aliases", () => {
  for (const view of ["tree", "kanban", "list", "timeline"]) {
    const route = {
      view,
      projectId: "prj-1",
      taskId: "tsk-1",
      ticketId: "tkt-2",
      modal: null,
      jobId: null,
      knowledgeId: null,
    };
    const url = routeUrl(route);
    assert.ok(url.startsWith(`/?view=${view}`));
    assert.deepEqual(parseRoute(url), route);
    assert.deepEqual(
      parseRoute(`/${view}?project=prj-1&task=tsk-1&ticket=tkt-2`),
      route,
    );
  }
  assert.equal(parseRoute("/").view, "tree");
  assert.equal(parseRoute("/?view=invalid").view, "tree");
  assert.equal(parseRoute("/list?view=timeline").view, "timeline");
  assert.equal(parseRoute("/kanban?project=prj-1").view, "kanban");
  assert.equal(routeUrl({ view: "unknown" }), "/?view=tree");
});

test("parseRoute and routeUrl synchronize all modal types, modal IDs, and /settings aliases", () => {
  assert.deepEqual(MODALS, ["task", "ticket", "job", "knowledge", "settings", "people"]);

  const cases = [
    {
      route: { view: "tree", projectId: "pj-1", taskId: "tsk-1", ticketId: null, modal: "task", jobId: null, knowledgeId: null },
      expectedUrl: "/?view=tree&project=pj-1&modal=task&task=tsk-1",
    },
    {
      route: { view: "kanban", projectId: "pj-1", taskId: "tsk-1", ticketId: "tkt-1", modal: "ticket", jobId: null, knowledgeId: null },
      expectedUrl: "/?view=kanban&project=pj-1&modal=ticket&task=tsk-1&ticket=tkt-1",
    },
    {
      route: { view: "list", projectId: "pj-1", taskId: "tsk-1", ticketId: "tkt-1", modal: "job", jobId: "job-1", knowledgeId: null },
      expectedUrl: "/?view=list&project=pj-1&modal=job&task=tsk-1&ticket=tkt-1&job=job-1",
    },
    {
      route: { view: "timeline", projectId: "pj-1", taskId: null, ticketId: null, modal: "knowledge", jobId: null, knowledgeId: null },
      expectedUrl: "/?view=timeline&project=pj-1&modal=knowledge",
    },
    {
      route: { view: "timeline", projectId: "pj-1", taskId: null, ticketId: null, modal: "knowledge", jobId: null, knowledgeId: "knw-9" },
      expectedUrl: "/?view=timeline&project=pj-1&modal=knowledge&knowledge=knw-9",
    },
    {
      route: { view: "tree", projectId: "pj-1", taskId: null, ticketId: null, modal: "settings", jobId: null, knowledgeId: null },
      expectedUrl: "/?view=tree&project=pj-1&modal=settings",
    },
    {
      route: { view: "tree", projectId: "pj-1", taskId: null, ticketId: null, modal: "people", jobId: null, knowledgeId: null },
      expectedUrl: "/?view=tree&project=pj-1&modal=people",
    },
  ];

  for (const { route, expectedUrl } of cases) {
    assert.equal(routeUrl(route), expectedUrl);
    assert.deepEqual(parseRoute(expectedUrl), route);
  }

  // Legacy /settings path alias and ?view=settings alias open settings modal
  assert.deepEqual(parseRoute("/settings?project=pj-1"), {
    view: "tree",
    projectId: "pj-1",
    taskId: null,
    ticketId: null,
    modal: "settings",
    jobId: null,
    knowledgeId: null,
  });
  assert.deepEqual(parseRoute("/?view=settings&project=pj-1"), {
    view: "tree",
    projectId: "pj-1",
    taskId: null,
    ticketId: null,
    modal: "settings",
    jobId: null,
    knowledgeId: null,
  });

  // Invalid modal and mismatched modal-specific params are stripped
  assert.deepEqual(parseRoute("/?view=tree&project=pj-1&modal=bogus&job=job-1&knowledge=knw-1"), {
    view: "tree",
    projectId: "pj-1",
    taskId: null,
    ticketId: null,
    modal: null,
    jobId: null,
    knowledgeId: null,
  });
  assert.equal(
    routeUrl({ view: "tree", projectId: "pj-1", modal: null, jobId: "job-1", knowledgeId: "knw-1" }),
    "/?view=tree&project=pj-1",
  );
  assert.equal(
    routeUrl({ view: "tree", projectId: "pj-1", modal: "ticket", taskId: "tsk-1", ticketId: "tkt-1", jobId: "job-1", knowledgeId: "knw-1" }),
    "/?view=tree&project=pj-1&modal=ticket&task=tsk-1&ticket=tkt-1",
  );
});

test("jobIcon, jobIconPath, colors, and visibleJobs match TTJ specification", () => {
  assert.equal(Object.keys(JOB_COLORS).length, 7);
  assert.equal(Object.keys(JOB_COLORS_DARK).length, 7);
  assert.equal(jobIcon({ display: { icon: "github" } }), "github");
  assert.equal(jobIcon({ display: { icon: "search" } }), "search");
  assert.equal(jobIcon({ display: { icon: "custom.star" } }), "custom.star");
  assert.equal(jobIcon({ display: { icon: "unknown.key" } }), "job");
  assert.equal(jobIcon({}), "job");
  assert.equal(jobIcon("id.copy"), "job");
  assert.equal(jobIconPath("github"), DEFAULT_ICONS.github);
  assert.equal(jobIconPath("id.copy"), DEFAULT_ICONS["id.copy"]);
  assert.equal(jobIcon("custom.mine", { "custom.mine": "/icons/star.png" }), "custom.mine");

  const eight = Array.from({ length: 8 }, (_, i) => row(`j-${i}`, `Job ${i}`, { status: "completed" }));
  assert.equal(visibleJobs(eight).length, 8);

  const twelve = Array.from({ length: 12 }, (_, i) =>
    row(`j-${i}`, `Job ${i}`, { status: i < 8 ? "completed" : i === 8 ? "doing" : "todo" }),
  );
  const windowJobs = visibleJobs(twelve);
  assert.equal(windowJobs.length, 8);
  assert.deepEqual(windowJobs.map(j => j.record.id), ["j-2", "j-3", "j-4", "j-5", "j-6", "j-7", "j-8", "j-9"]);
});

test("visibleWork filters trailing completed/waiting tickets and all-paused branches while keeping paths to active targets", () => {
  const filterSnap = {
    project: row("prj-f", "Filter", { name: "Filter PJ" }),
    tasks: [
      {
        task: row("tsk-active", "Active Task", { status: "doing" }),
        tickets: [
          { ticket: row("tkt-done-root", "Done Prerequisite", { status: "completed" }), jobs: [] },
          { ticket: row("tkt-doing", "Current Work", { status: "doing", depends: ["tkt-done-root"] }), jobs: [] },
          { ticket: row("tkt-wait-tail", "Waiting Tail", { status: "waiting", depends: ["tkt-doing"] }), jobs: [] },
          { ticket: row("tkt-done-tail", "Done Leaf", { status: "completed" }), jobs: [] },
        ],
      },
      {
        task: row("tsk-paused", "Paused Branch Task", { status: "paused" }),
        tickets: [
          { ticket: row("tkt-paused-only", "Paused Leaf", { status: "paused" }), jobs: [] },
        ],
      },
      {
        task: row("tsk-empty-active", "Empty Todo Task", { status: "todo" }),
        tickets: [],
      },
    ],
  };

  const all = visibleWork(filterSnap, { workOnly: false });
  assert.equal(all.size, 8);

  const filtered = visibleWork(filterSnap, { workOnly: true });
  assert.ok(filtered.has("tsk-active"));
  assert.ok(filtered.has("tkt-done-root"), "prerequisite on path to doing ticket stays visible");
  assert.ok(filtered.has("tkt-doing"), "active doing ticket stays visible");
  assert.ok(!filtered.has("tkt-wait-tail"), "trailing waiting ticket is omitted");
  assert.ok(!filtered.has("tkt-done-tail"), "standalone completed leaf is omitted");
  assert.ok(!filtered.has("tsk-paused"), "task whose frontier is all paused is omitted");
  assert.ok(!filtered.has("tkt-paused-only"), "paused leaf is omitted");
  assert.ok(filtered.has("tsk-empty-active"), "empty non-paused active task stays visible");

  const filteredScene = treeScene(filterSnap, { workOnly: true });
  assert.deepEqual(
    filteredScene.nodes.map(n => n.row.record.id).sort(),
    ["tkt-doing", "tkt-done-root", "tsk-active", "tsk-empty-active"],
  );

  const filteredKanban = kanbanColumns(filterSnap, null, { workOnly: true });
  const visibleKanbanIds = filteredKanban.flatMap(col => col.cards.map(c => c.ticketId)).sort();
  assert.deepEqual(visibleKanbanIds, ["tkt-doing", "tkt-done-root"]);

  const filteredRows = workRows(filterSnap, { workOnly: true });
  assert.equal(filteredRows.length, 4);
});

test("tree connects only blockers (no extra Task->Ticket edge when depends exist), uses uniform card sizes and topological rows", () => {
  const scene = treeScene(snapshot);
  assert.equal(workRows(snapshot).length, 3);
  assert.deepEqual(projectSummary(snapshot), { tasks: 1, tickets: 2, doing: 1, completed: 1 });
  for (const node of scene.nodes) {
    assert.equal(node.width, TREE_METRICS.cardWidth, `node ${node.row.record.id} width must be uniform`);
    assert.equal(node.height, TREE_METRICS.cardHeight, `node ${node.row.record.id} height must be uniform`);
  }
  const taskNode = scene.nodes.find(item => item.kind === "task");
  const first = scene.nodes.find(item => item.ticketId === "tkt-1");
  const second = scene.nodes.find(item => item.ticketId === "tkt-2");
  assert.ok(second.x > first.x);
  assert.equal(taskNode.rowIndex, first.rowIndex);
  assert.equal(first.rowIndex, second.rowIndex, "chain aligns on the same row via topological layout");
  assert.equal(first.depth, 0);
  assert.equal(second.depth, 1);
  assert.deepEqual(second.dependsTitles, ["Ticket 1", "tkt-external"]);

  // Unified single-type edges: tsk-1 -> tkt-1 and tkt-1 -> tkt-2 ONLY (NO tsk-1 -> tkt-2!).
  assert.deepEqual(
    scene.edges.map(e => `${e.from}->${e.to}`),
    ["tsk-1->tkt-1", "tkt-1->tkt-2"],
  );
  assert.ok(scene.edges.every(e => !("dependency" in e)), "edges must be unified without separate dependency style");
  assert.ok(scene.edges.every(e => Array.isArray(e.points) && e.points.length >= 2));
});

test("tree distinguishes junctions (shared source/target) from bridges (unrelated crossings) on unified edges and enforces doubled clearances", () => {
  const scene = treeScene(richSnapshot);
  const byId = new Map(scene.nodes.map(node => [node.row.record.id, node]));

  // Verify no dependent ticket receives an extra edge from its Task.
  for (const node of scene.nodes) {
    if (node.kind !== "ticket") continue;
    const visibleDeps = (node.row.record.depends || []).filter(id => byId.has(id));
    const incomingFrom = scene.edges.filter(e => e.to === node.ticketId).map(e => e.from).sort();
    if (visibleDeps.length) {
      assert.deepEqual(incomingFrom, [...visibleDeps].sort(), `ticket ${node.ticketId} must only connect from blockers`);
      assert.ok(!incomingFrom.includes(node.taskId), `ticket ${node.ticketId} must not also connect from Task ${node.taskId}`);
    } else {
      assert.deepEqual(incomingFrom, [node.taskId], `root ticket ${node.ticketId} must connect from Task ${node.taskId}`);
    }
  }

  assert.ok(scene.junctions.length > 0, "expected branch/merge junctions to be detected");
  assert.ok(
    scene.junctions.some(j => j.kind === "branch"),
    "expected at least one branch junction from shared source",
  );
  assert.ok(
    scene.junctions.some(j => j.kind === "merge" && j.nodeId === "tkt-a5"),
    "expected merge junction for converging dependencies into tkt-a5",
  );

  // Also test a graph with an unavoidable unrelated orthogonal crossing (a1->c1 vertical crosses a2->b2 horizontal)
  // to verify semicircular bridge arcs on unified edges.
  const crossSnapshot = {
    project: row("prj-x", "Cross", { name: "Cross" }),
    tasks: [
      {
        task: row("tsk-1", "Task 1", { status: "doing" }),
        tickets: [
          { ticket: row("a1", "A1", { status: "completed" }), jobs: [] },
          { ticket: row("b1", "B1", { status: "doing", depends: ["a1"] }), jobs: [] },
        ],
      },
      {
        task: row("tsk-2", "Task 2", { status: "doing" }),
        tickets: [
          { ticket: row("a2", "A2", { status: "doing" }), jobs: [] },
          { ticket: row("b2", "B2", { status: "todo", depends: ["a2"] }), jobs: [] },
          { ticket: row("c1", "C1", { status: "todo", depends: ["a1", "b2"] }), jobs: [] },
        ],
      },
    ],
  };
  const crossScene = treeScene(crossSnapshot);
  assert.ok(crossScene.bridges.length > 0, "expected unrelated orthogonal crossing to produce bridge arc");
  assert.ok(
    crossScene.edges.map(edge => edgePathD(edge, crossScene.bridges)).some(d => d.includes(" A ")),
    "expected edgePathD to generate SVG arc commands for bridges",
  );

  assert.equal(TREE_METRICS.entryOffsetY, TREE_METRICS.cardHeight / 2);
  assert.equal(TREE_METRICS.branchExitOffsetY, TREE_METRICS.cardHeight / 2);

  for (const activeScene of [scene, crossScene]) {
    const activeById = new Map(activeScene.nodes.map(node => [node.row.record.id, node]));

    // Every edge must exit strictly from vertical center of fromNode and enter vertical center of toNode.
    for (const edge of activeScene.edges) {
      const fromNode = activeById.get(edge.from);
      const toNode = activeById.get(edge.to);
      assert.ok(fromNode && toNode, `edge ${edge.from}->${edge.to} endpoints must exist`);
      assert.equal(
        edge.points[0][1],
        fromNode.y + TREE_METRICS.cardHeight / 2,
        `edge ${edge.from}->${edge.to} startY must equal fromNode center`,
      );
      assert.equal(
        edge.points[edge.points.length - 1][1],
        toNode.y + TREE_METRICS.cardHeight / 2,
        `edge ${edge.from}->${edge.to} endY must equal toNode center`,
      );
    }
    for (const bridge of activeScene.bridges) {
      assert.equal(bridge.orientation, "horizontal");
      assert.equal(bridge.radius, TREE_METRICS.bridgeRadius);
      assert.notEqual(bridge.over.from, bridge.under.from);
      assert.notEqual(bridge.over.to, bridge.under.to);
    }

    const junctionKeys = new Set(activeScene.junctions.map(j => `${j.x}:${j.y}`));
    for (const bridge of activeScene.bridges) {
      assert.ok(!junctionKeys.has(`${bridge.x}:${bridge.y}`), `point ${bridge.x}:${bridge.y} must not be both bridge and junction`);
    }

    const cols = [...new Set(activeScene.nodes.map(n => n.column))].sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i++) {
      const prevNode = activeScene.nodes.find(n => n.column === cols[i - 1]);
      const nextNode = activeScene.nodes.find(n => n.column === cols[i]);
      const gap = nextNode.x - (prevNode.x + prevNode.width);
      assert.ok(gap >= 84, `column gap ${gap}px between col ${cols[i - 1]} and ${cols[i]} must be >= 84px`);
    }

    const minClear = TREE_METRICS.minClearance;
    for (const bridge of activeScene.bridges) {
      for (const edge of activeScene.edges) {
        const pts = edge.points;
        for (let i = 1; i < pts.length; i++) {
          const [x1, y1] = pts[i - 1];
          const [x2, y2] = pts[i];
          if (y1 === y2 && y1 === bridge.y && bridge.x > Math.min(x1, x2) && bridge.x < Math.max(x1, x2)) {
            assert.ok(bridge.x - Math.min(x1, x2) >= minClear);
            assert.ok(Math.max(x1, x2) - bridge.x >= minClear);
          }
          if (x1 === x2 && x1 === bridge.x && bridge.y > Math.min(y1, y2) && bridge.y < Math.max(y1, y2)) {
            assert.ok(bridge.y - Math.min(y1, y2) >= minClear);
            assert.ok(Math.max(y1, y2) - bridge.y >= minClear);
          }
        }
      }
    }

    for (const junction of activeScene.junctions) {
      for (const edge of activeScene.edges) {
        const first = edge.points[0];
        const last = edge.points[edge.points.length - 1];
        if (first[1] === junction.y) {
          assert.ok(Math.abs(junction.x - first[0]) >= minClear);
        }
        if (last[1] === junction.y) {
          assert.ok(Math.abs(last[0] - junction.x) >= minClear);
        }
      }
    }

    for (const edge of activeScene.edges) {
      const pts = edge.points;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1];
        const [x2, y2] = pts[i];
        for (const node of activeById.values()) {
          if (y1 === y2) {
            const insideY = y1 > node.y && y1 < node.y + node.height;
            const overlapX = Math.max(x1, x2) > node.x && Math.min(x1, x2) < node.x + node.width;
            assert.ok(!(insideY && overlapX));
          } else if (x1 === x2) {
            const insideX = x1 > node.x && x1 < node.x + node.width;
            const overlapY = Math.max(y1, y2) > node.y && Math.min(y1, y2) < node.y + node.height;
            assert.ok(!(insideX && overlapY));
          }
        }
      }
    }
  }

  assert.ok(TREE_METRICS.minColGap >= 84);
  assert.ok(TREE_METRICS.laneStep >= 24);
  assert.ok(TREE_METRICS.minClearance >= 20);
  assert.ok(TREE_METRICS.startStub >= 28);
  assert.ok(TREE_METRICS.endStub >= 28);
});

test("kanban groups tickets by TTJ status, keeps empty columns visible, and resolves progress", () => {
  const columns = kanbanColumns(richSnapshot);
  assert.deepEqual(
    columns.map(col => col.key),
    ["todo", "doing", "waiting", "held", "completed", "canceled"],
  );
  assert.deepEqual(
    Object.fromEntries(columns.map(col => [col.key, col.cards.map(card => card.ticketId)])),
    {
      todo: ["tkt-a5"],
      doing: ["tkt-a3"],
      waiting: ["tkt-a4"],
      held: ["tkt-b1", "tkt-b2"],
      completed: ["tkt-a1", "tkt-a2"],
      canceled: ["tkt-b3"],
    },
  );
  const doingCard = columns.find(col => col.key === "doing").cards[0];
  assert.equal(doingCard.taskObjective, "設計と基盤構築");
  assert.equal(doingCard.progress.percent, 65);
  assert.equal(doingCard.hasDependencies, true);
  assert.deepEqual(doingCard.dependsTitles, ["スキーマ設計"]);

  const sparseColumns = kanbanColumns(snapshot);
  assert.equal(sparseColumns.length, 6);
  assert.equal(sparseColumns.find(col => col.key === "todo").cards.length, 0);
  assert.equal(sparseColumns.find(col => col.key === "waiting").cards.length, 0);
  assert.equal(sparseColumns.find(col => col.key === "held").cards.length, 0);
  assert.equal(sparseColumns.find(col => col.key === "canceled").cards.length, 0);
});

test("timeline orders equal timestamps by event id and resolves Run ownership", () => {
  const timestamp = "2026-11-24T12:00:00Z";
  const result = timelineRows({
    ...snapshot,
    timeline: [
      { id: 1, target: "run-1", event: "run.started", timestamp, kind: "run", to: { record: { id: "run-1" } } },
      { id: 3, target: "tkt-2", event: "status.changed", timestamp, from: { record: { status: "todo" } }, to: { record: { status: "doing" } } },
      { id: 2, target: "run-1", event: "run.progress_changed", timestamp, to: { record: { id: "run-1" }, progress: { percent: 37, message: "確認中" } } },
      { id: 4, target: "deleted", event: "record.deleted", timestamp: "2026-11-24T11:00:00Z", from: { record: { objective: "削除済みの作業" } } },
    ],
  });
  assert.deepEqual(result.map(event => event.id), [3, 2, 1, 4]);
  assert.equal(result[0].transition, "未着手 → 作業中");
  assert.equal(result[1].owner.ticketId, "tkt-1");
  assert.equal(result[1].title, "Job 1");
  assert.equal(result[1].progress.percent, 37);
  assert.equal(result[3].title, "削除済みの作業");
  assert.equal(result[3].owner, undefined);
});

test("tree view label uses ツリー instead of キャンバス", () => {
  assert.equal(VIEWS.tree, "ツリー");
  assert.ok(!Object.values(VIEWS).some(label => label.includes("キャンバス")));
});

test("filterWork combines workOnly, statuses, workerId, and query consistently across tree, kanban, and list", () => {
  assert.equal(hasActiveFilters({}), false);
  assert.equal(activeFilterCount({ workOnly: true, statuses: ["doing"], workerId: "wkr-1", query: "API" }), 4);

  // Status multi-select filter
  const statusFiltered = filterWork(richSnapshot, { statuses: ["doing", "blocked"] });
  assert.deepEqual(
    [...statusFiltered].sort(),
    ["tkt-a3", "tkt-b2", "tsk-a", "tsk-b"],
  );

  // Worker filter retains only matching worker's tickets and their parent tasks
  const workerFiltered = filterWork(richSnapshot, { workerId: "wkr-2" });
  assert.deepEqual(
    [...workerFiltered].sort(),
    ["tkt-a2", "tkt-a4", "tkt-b1", "tkt-b3", "tsk-a", "tsk-b"],
  );

  // Keyword query matches ticket objective, ID, and job objective
  assert.deepEqual([...filterWork(richSnapshot, { query: "セキュリティ" })].sort(), ["tkt-b2", "tsk-b"]);
  assert.deepEqual([...filterWork(richSnapshot, { query: "tkt-a3" })].sort(), ["tkt-a3", "tsk-a"]);
  assert.deepEqual([...filterWork(richSnapshot, { query: "計測" })].sort(), ["tkt-b1", "tsk-b"]);

  // Combined filters apply cleanly to treeScene, kanbanColumns, and workRows without broken tree edges
  const combo = { statuses: ["doing", "waiting"], workerId: "wkr-1" };
  const comboScene = treeScene(richSnapshot, combo);
  assert.deepEqual(comboScene.nodes.map(n => n.row.record.id).sort(), ["tkt-a3", "tsk-a"]);
  const nodeIds = new Set(comboScene.nodes.map(n => n.row.record.id));
  for (const edge of comboScene.edges) {
    assert.ok(nodeIds.has(edge.from) && nodeIds.has(edge.to), "filtered tree must have no dangling edges");
  }
  const comboKanban = kanbanColumns(richSnapshot, null, combo);
  assert.deepEqual(comboKanban.flatMap(c => c.cards.map(card => card.ticketId)), ["tkt-a3"]);
  const comboList = workRows(richSnapshot, combo);
  assert.deepEqual(comboList.map(r => r.row.record.id).sort(), ["tkt-a3", "tsk-a"]);
});

test("formatTimestamp and timelineRows convert timestamps across JST, UTC, and local timezones", () => {
  const iso = "2026-11-24T16:30:00Z";
  assert.equal(formatTimestamp(iso, "UTC"), "2026-11-24 16:30:00 UTC");
  assert.equal(formatTimestamp(iso, "JST"), "2026-11-25 01:30:00 JST");
  assert.match(formatTimestamp(iso, "local"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/);

  const tzSnap = {
    ...snapshot,
    timeline: [
      { id: 10, target: "tkt-2", event: "status.changed", timestamp: iso, to: { record: { status: "doing" } } },
    ],
  };
  const jstRows = timelineRows(tzSnap, { timeZone: "JST" });
  const utcRows = timelineRows(tzSnap, { timeZone: "UTC" });
  assert.equal(jstRows[0].dateLabel, "2026-11-25");
  assert.equal(jstRows[0].timeLabel, "01:30");
  assert.equal(utcRows[0].dateLabel, "2026-11-24");
  assert.equal(utcRows[0].timeLabel, "16:30");
});

test("canDeleteTask, canPurgeTask, and canDeleteProject enforce TTJCore lifecycle rules", () => {
  const purgeSnap = {
    project: row("pj-1", "P1", { name: "P1" }),
    tasks: [
      {
        task: row("tsk-done", "Done Task", { status: "completed" }),
        tickets: [
          {
            ticket: row("tkt-done", "Done Ticket", { status: "completed" }),
            jobs: [row("job-done", "Done Job", { status: "completed", runs: [{ id: "run-1", ended: "2026-11-24T12:00:00Z", result: "succeeded" }] })],
          },
        ],
      },
      {
        task: row("tsk-referenced", "Referenced Task", { status: "canceled" }),
        tickets: [
          { ticket: row("tkt-ref-target", "Ref Target", { status: "completed" }), jobs: [] },
        ],
      },
      {
        task: row("tsk-active", "Active Task", { status: "doing" }),
        tickets: [
          { ticket: row("tkt-dep", "Dependent", { status: "doing", depends: ["tkt-ref-target"] }), jobs: [] },
        ],
      },
    ],
  };

  assert.equal(canDeleteTask(purgeSnap, purgeSnap.tasks[0].task), true);
  assert.equal(canPurgeTask(purgeSnap, purgeSnap.tasks[0].task), true);
  assert.equal(canDeleteTask(purgeSnap, purgeSnap.tasks[1].task), true);
  assert.equal(canPurgeTask(purgeSnap, purgeSnap.tasks[1].task), false, "cannot purge when another task depends on its ticket");
  assert.equal(canDeleteTask(purgeSnap, purgeSnap.tasks[2].task), false);
  assert.equal(canPurgeTask(purgeSnap, purgeSnap.tasks[2].task), false);
  assert.equal(canDeleteProject(purgeSnap), false);

  const allDoneSnap = { project: purgeSnap.project, tasks: [purgeSnap.tasks[0]] };
  assert.equal(canDeleteProject(allDoneSnap), true);
});

test("single-lane branch and merge junctions sit at the exact horizontal midpoint of the column gap", () => {
  const branchSnap = {
    project: row("pj-mid", "Midpoint", { name: "Midpoint" }),
    tasks: [
      {
        task: row("tsk-m1", "Root Task", { status: "doing" }),
        tickets: [
          { ticket: row("tkt-root", "Root Ticket", { status: "completed" }), jobs: [] },
          { ticket: row("tkt-b1", "Branch 1", { status: "doing", depends: ["tkt-root"] }), jobs: [] },
          { ticket: row("tkt-b2", "Branch 2", { status: "todo", depends: ["tkt-root"] }), jobs: [] },
          { ticket: row("tkt-merge", "Merge Ticket", { status: "todo", depends: ["tkt-b1", "tkt-b2"] }), jobs: [] },
        ],
      },
    ],
  };

  const midScene = treeScene(branchSnap);
  const byId = new Map(midScene.nodes.map(n => [n.row.record.id, n]));
  const root = byId.get("tkt-root");
  const b1 = byId.get("tkt-b1");
  const merge = byId.get("tkt-merge");

  const branchMidX = Math.round((root.x + root.width + b1.x) / 2);
  const mergeMidX = Math.round((b1.x + b1.width + merge.x) / 2);

  const branchJunction = midScene.junctions.find(j => j.kind === "branch" && j.nodeId === "tkt-root");
  assert.ok(branchJunction, "expected branch junction from tkt-root");
  assert.equal(branchJunction.x, branchMidX, "single-lane branch junction X must equal exact midpoint of column gap");
  assert.equal(branchJunction.y, root.y + TREE_METRICS.cardHeight / 2);

  const mergeJunction = midScene.junctions.find(j => j.kind === "merge" && j.nodeId === "tkt-merge");
  assert.ok(mergeJunction, "expected merge junction into tkt-merge");
  assert.equal(mergeJunction.x, mergeMidX, "single-lane merge junction X must equal exact midpoint of column gap");
  assert.equal(mergeJunction.y, merge.y + TREE_METRICS.cardHeight / 2);
});

test("custom icon keys validate, sanitize SVG, resolve PNG/SVG assets, and reject unsafe inputs", () => {
  assert.ok(PRESET_ICON_ASSETS.length >= 12);
  assert.equal(isValidIconKey("custom.deploy"), true);
  assert.equal(isValidIconKey("qa_check-1"), true);
  assert.equal(isValidIconKey(""), false);
  assert.equal(isValidIconKey("bad key"), false);
  assert.equal(isValidIconKey("../evil"), false);
  assert.equal(isValidIconKey("id.copy"), false);
  assert.equal(isStandardIconKey("github"), true);
  assert.equal(isStandardIconKey("custom.deploy"), false);

  const pngData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const coloredSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#2563eb"/></svg>';
  const monoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M2 2h12v12H2z"/></svg>';
  const coloredSvgData = "data:image/svg+xml;base64," + Buffer.from(coloredSvg).toString("base64");
  const monoSvgData = "data:image/svg+xml;base64," + Buffer.from(monoSvg).toString("base64");

  const customIcons = sanitizeCustomIconsMap({
    "custom.deploy": { label: "デプロイ", src: "/icons/folder.svg", kind: "preset", sourceName: "folder.svg" },
    "custom.png": { label: "PNGバッジ", src: pngData, kind: "upload", sourceName: "badge.png" },
    "custom.svgcol": { label: "カラーSVG", src: coloredSvgData, kind: "upload", sourceName: "color.svg" },
    "custom.svgmono": { label: "単色SVG", src: monoSvgData, kind: "upload", sourceName: "mono.svg" },
    github: { label: "標準上書き試行", src: "/icons/folder.svg" },
    "custom.evil": { label: "外部URL", src: "https://evil.example/a.svg" },
    "custom.traversal": { label: "トラバーサル", src: "/icons/../server.py" },
  });

  assert.deepEqual(Object.keys(customIcons).sort(), ["custom.deploy", "custom.png", "custom.svgcol", "custom.svgmono"]);
  assert.equal(jobIcon({ display: { icon: "custom.deploy" } }, customIcons), "custom.deploy");
  assert.equal(jobIcon({ display: { icon: "custom.png" } }, customIcons), "custom.png");
  assert.equal(jobIcon({ display: { icon: "custom.evil" } }, customIcons), "job");

  const pngAsset = jobIconAsset({ display: { icon: "custom.png" } }, customIcons);
  assert.equal(pngAsset.key, "custom.png");
  assert.equal(pngAsset.format, "png");
  assert.equal(pngAsset.renderMode, "img");

  const coloredAsset = jobIconAsset({ display: { icon: "custom.svgcol" } }, customIcons);
  assert.equal(coloredAsset.format, "svg");
  assert.equal(coloredAsset.renderMode, "img");

  const monoAsset = jobIconAsset({ display: { icon: "custom.svgmono" } }, customIcons);
  assert.equal(monoAsset.format, "svg");
  assert.equal(monoAsset.renderMode, "mask");

  const presetAsset = jobIconAsset({ display: { icon: "custom.deploy" } }, customIcons);
  assert.equal(presetAsset.src, "/icons/folder.svg");
  assert.equal(presetAsset.renderMode, "mask");

  assert.equal(isSafeIconSource("javascript:alert(1)"), false);
  assert.equal(isSafeIconSource("data:text/html;base64,PHNjcmlwdD4="), false);

  const dirtySvg = `<?xml version="1.0"?>
    <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 16 16">
      <script>alert("xss")</script>
      <foreignObject><body onload="alert(2)"></body></foreignObject>
      <image href="https://evil.example/p.png"/>
      <a href="javascript:alert(3)"><circle cx="8" cy="8" r="5" onclick="evil()" fill="#16a34a"/></a>
    </svg>`;
  const clean = sanitizeSvgMarkup(dirtySvg);
  assert.ok(clean.startsWith("<svg") && clean.endsWith("</svg>"));
  assert.ok(!/script/i.test(clean));
  assert.ok(!/onload|onclick/i.test(clean));
  assert.ok(!/javascript:/i.test(clean));
  assert.ok(!/foreignObject|evil\.example/i.test(clean));
  assert.ok(clean.includes('fill="#16a34a"'));

  assert.throws(() => sanitizeSvgMarkup("not svg text"));
  assert.throws(() => sanitizeSvgMarkup("<svg>" + "a".repeat(130 * 1024) + "</svg>"));

  const opts = allJobIconOptions(customIcons);
  assert.ok(opts.some(o => o.value === "custom.deploy" && o.isCustom && o.label.includes("デプロイ")));
});

test("filterWork filters by iconKeys including custom icon keys and combines with workOnly, statuses, workerId, and query", () => {
  const customIcons = {
    "custom.deploy": { label: "デプロイ", src: "/icons/folder.svg", kind: "preset" },
  };
  const iconSnap = {
    project: row("prj-ico", "Icon Filter PJ", { name: "Icon Filter PJ" }),
    tasks: [
      {
        task: row("tsk-1", "開発タスク", { status: "doing" }),
        tickets: [
          {
            ticket: row("tkt-1", "API調査と設計", { status: "doing", worker_id: "wkr-1" }),
            jobs: [
              row("job-1a", "調査", { status: "completed" }, { icon: "search" }),
              row("job-1b", "実装", { status: "doing" }, { icon: "edit" }),
            ],
          },
          {
            ticket: row("tkt-2", "本番デプロイ", { status: "todo", worker_id: "wkr-2", depends: ["tkt-1"] }),
            jobs: [
              row("job-2a", "デプロイ実行", { status: "todo" }, { icon: "custom.deploy" }),
            ],
          },
          {
            ticket: row("tkt-3", "完了デプロイ履歴", { status: "completed", worker_id: "wkr-1" }),
            jobs: [
              row("job-3a", "旧デプロイ", { status: "completed" }, { icon: "custom.deploy" }),
            ],
          },
        ],
      },
      {
        task: row("tsk-2", "ドキュメントタスク", { status: "todo" }),
        tickets: [
          {
            ticket: row("tkt-4", "手順書作成", { status: "todo", worker_id: "wkr-2" }),
            jobs: [
              row("job-4a", "記述", { status: "todo" }, { icon: "book" }),
            ],
          },
        ],
      },
    ],
  };

  assert.equal(activeFilterCount({ iconKeys: ["custom.deploy"] }), 1);
  assert.equal(activeFilterCount({ workOnly: true, statuses: ["todo"], iconKeys: ["custom.deploy"], workerId: "wkr-2", query: "デプロイ" }), 5);

  // Filter by custom icon key (Set or Array)
  const deployOnly = filterWork(iconSnap, { iconKeys: new Set(["custom.deploy"]) }, customIcons);
  assert.deepEqual([...deployOnly].sort(), ["tkt-2", "tkt-3", "tsk-1"]);

  // Multi-select iconKeys
  const multiIcon = filterWork(iconSnap, { iconKeys: ["search", "book"] }, customIcons);
  assert.deepEqual([...multiIcon].sort(), ["tkt-1", "tkt-4", "tsk-1", "tsk-2"]);

  // Combined AND with workOnly + statuses + workerId + query
  const combo = {
    workOnly: true,
    statuses: ["todo"],
    iconKeys: ["custom.deploy"],
    workerId: "wkr-2",
    query: "本番",
    customIcons,
  };
  assert.deepEqual([...filterWork(iconSnap, combo)].sort(), ["tkt-2", "tsk-1"]);

  const scene = treeScene(iconSnap, combo);
  assert.deepEqual(scene.nodes.map(n => n.row.record.id).sort(), ["tkt-2", "tsk-1"]);
  assert.deepEqual(scene.edges.map(e => `${e.from}->${e.to}`), ["tsk-1->tkt-2"]);

  const kanban = kanbanColumns(iconSnap, null, combo);
  assert.deepEqual(kanban.flatMap(col => col.cards.map(c => c.ticketId)), ["tkt-2"]);

  const rows = workRows(iconSnap, combo);
  assert.deepEqual(rows.map(r => r.row.record.id).sort(), ["tkt-2", "tsk-1"]);

  const keys = projectIconKeys(iconSnap, customIcons);
  assert.ok(keys.includes("custom.deploy"));
  assert.ok(keys.includes("search"));
});

test("parseDependsInput parses comma, space, newline, and full-width separators without duplicates", () => {
  assert.deepEqual(parseDependsInput("tkt-1, tkt-2\ntkt-3　tkt-1  tkt-4、tkt-2"), ["tkt-1", "tkt-2", "tkt-3", "tkt-4"]);
  assert.deepEqual(parseDependsInput("   "), []);
  assert.deepEqual(parseDependsInput(["tkt-a", " tkt-b ", "tkt-a"]), ["tkt-a", "tkt-b"]);
});

test("filterTimelineRows filters by query, statuses, workerId, iconKeys, workOnly, and preserves knowledge inference", () => {
  const customIcons = {
    "custom.deploy": { label: "デプロイ", src: "/icons/folder.svg", kind: "preset" },
  };
  const tlSnap = {
    project: row("pj-tl", "Timeline PJ", { name: "Timeline PJ" }),
    knowledge: [
      row("knw-active", "", { content: "APIはHTTPS必須", basis: "セキュリティ方針", status: "active" }),
    ],
    tasks: [
      {
        task: row("tsk-active", "API開発", { status: "doing" }),
        tickets: [
          {
            ticket: row("tkt-doing", "認証エンドポイント実装", { status: "doing", worker_id: "wkr-1" }),
            jobs: [
              row("job-edit", "コード実装", { status: "doing", runs: [{ id: "run-edit", active: true }] }, { icon: "edit" }),
              row("job-deploy", "ステージング配備", { status: "todo" }, { icon: "custom.deploy" }),
            ],
          },
          {
            ticket: row("tkt-done", "完了済みの旧調査", { status: "completed", worker_id: "wkr-2" }),
            jobs: [
              row("job-search", "資料確認", { status: "completed", runs: [{ id: "run-search" }] }, { icon: "search" }),
            ],
          },
        ],
      },
      {
        task: row("tsk-paused", "保留中タスク", { status: "paused" }),
        tickets: [
          {
            ticket: row("tkt-paused", "保留作業", { status: "paused", worker_id: "wkr-2" }),
            jobs: [row("job-paused", "待機Job", { status: "paused" }, { icon: "review" })],
          },
        ],
      },
    ],
    timeline: [
      {
        id: 1,
        target: "tsk-active",
        kind: "task",
        event: "record.created",
        timestamp: "2026-11-24T10:00:00Z",
        actor: ["ttjweb"],
        reason: "初期計画の登録",
        to: { record: { id: "tsk-active", objective: "API開発", status: "todo" } },
      },
      {
        id: 2,
        target: "tkt-doing",
        kind: "ticket",
        event: "status.changed",
        timestamp: "2026-11-24T10:05:00Z",
        actor: ["ttjweb"],
        reason: "実装開始",
        from: { record: { status: "todo" } },
        to: { record: { status: "doing", objective: "認証エンドポイント実装" } },
      },
      {
        id: 3,
        target: "run-edit",
        kind: "run",
        event: "run.progress_changed",
        timestamp: "2026-11-24T10:10:00Z",
        actor: ["wkr-1", "ssn-1"],
        to: { record: { id: "run-edit", job: "job-edit" }, progress: { percent: 50, message: "JWT検証を追加中" } },
      },
      {
        id: 4,
        target: "job-deploy",
        kind: "job",
        event: "record.created",
        timestamp: "2026-11-24T10:12:00Z",
        actor: ["ttjweb"],
        to: { record: { id: "job-deploy", objective: "ステージング配備", status: "todo" } },
      },
      {
        id: 5,
        target: "tkt-done",
        kind: "ticket",
        event: "status.changed",
        timestamp: "2026-11-24T10:15:00Z",
        actor: ["wkr-2", "ssn-2"],
        reason: "調査完了",
        from: { record: { status: "doing" } },
        to: { record: { status: "completed", objective: "完了済みの旧調査" } },
      },
      {
        id: 6,
        target: "tkt-paused",
        kind: "ticket",
        event: "status.changed",
        timestamp: "2026-11-24T10:18:00Z",
        actor: ["ttjweb"],
        reason: "優先度調整のため保留",
        from: { record: { status: "todo" } },
        to: { record: { status: "paused", objective: "保留作業" } },
      },
      {
        id: 7,
        target: "knw-active",
        kind: "knowledge",
        event: "record.created",
        timestamp: "2026-11-24T10:20:00Z",
        actor: ["ttjweb"],
        reason: "方針を記録",
        to: { record: { id: "knw-active", content: "APIはHTTPS必須", basis: "セキュリティ方針", status: "active" } },
      },
      {
        id: 8,
        target: "knw-old",
        event: "knowledge.superseded",
        timestamp: "2026-11-24T10:21:00Z",
        actor: ["ttjweb"],
        reason: "旧方針を置換",
        from: { record: { id: "knw-old", content: "旧HTTP許可方針", status: "active" } },
        to: { record: { id: "knw-old", content: "旧HTTP許可方針", status: "supersed" } },
      },
    ],
  };

  const rows = timelineRows(tlSnap);
  assert.equal(rows.length, 8);
  const oldKnwRow = rows.find(r => r.target === "knw-old");
  assert.equal(oldKnwRow.kind, "knowledge", "superseded knowledge without snapshot entry infers knowledge kind");

  // Unfiltered returns all events
  assert.equal(filterTimelineRows(rows, tlSnap, {}, customIcons).length, 8);

  // Query matches title, kind, event/label, actor, reason, progress message, target ID
  assert.deepEqual(filterTimelineRows(rows, tlSnap, { query: "JWT検証" }, customIcons).map(e => e.id), [3]);
  assert.deepEqual(filterTimelineRows(rows, tlSnap, { query: "優先度調整" }, customIcons).map(e => e.id), [6]);
  assert.deepEqual(filterTimelineRows(rows, tlSnap, { query: "knw-old" }, customIcons).map(e => e.id), [8]);
  assert.deepEqual(filterTimelineRows(rows, tlSnap, { query: "Knowledge" }, customIcons).map(e => e.id), [8, 7]);
  assert.deepEqual(filterTimelineRows(rows, tlSnap, { query: "ssn-1" }, customIcons).map(e => e.id), [3]);
  assert.deepEqual(filterTimelineRows(rows, tlSnap, { query: "進捗報告" }, customIcons).map(e => e.id), [3]);

  // Status filter matches afterStatus or current status of target record (run-edit inherits doing from job-edit)
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { statuses: ["doing"] }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [2, 3],
  );
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { statuses: ["completed", "paused"] }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [5, 6],
  );

  // Worker filter matches target ticket's worker_id OR event actor
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { workerId: "wkr-1" }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [2, 3, 4],
  );
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { workerId: "wkr-2" }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [5, 6],
  );

  // Icon key filter matches Job/Run of that icon and Ticket containing that Job (including custom icons)
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { iconKeys: ["edit"] }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [2, 3],
  );
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { iconKeys: ["custom.deploy"] }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [2, 4],
  );
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { iconKeys: ["search"] }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [5],
  );

  // workOnly filters to visibleWork(snapshot, { workOnly: true }) (tsk-active, tkt-doing + its jobs/runs)
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { workOnly: true }, customIcons).map(e => e.id).sort((a, b) => a - b),
    [1, 2, 3, 4],
  );

  // Combined AND + empty result
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { workOnly: true, statuses: ["doing"], workerId: "wkr-1", iconKeys: ["edit"], query: "JWT" }, customIcons).map(e => e.id),
    [3],
  );
  assert.deepEqual(
    filterTimelineRows(rows, tlSnap, { query: "存在しないキーワードXYZ" }, customIcons),
    [],
  );
});

test("parseRoute and routeUrl preserve tree direction query parameter and layout alias", () => {
  assert.deepEqual(TREE_DIRECTIONS, ["horizontal", "vertical"]);
  assert.equal(normalizeTreeDirection("vertical"), "vertical");
  assert.equal(normalizeTreeDirection("horizontal"), "horizontal");
  assert.equal(normalizeTreeDirection("invalid", "vertical"), "vertical");
  assert.equal(normalizeTreeDirection(null, "horizontal"), "horizontal");

  const vertRoute = {
    view: "tree",
    dir: "vertical",
    projectId: "pj-1",
    taskId: "tsk-1",
    ticketId: "tkt-2",
    modal: "ticket",
    jobId: null,
    knowledgeId: null,
  };
  const vertUrl = routeUrl(vertRoute);
  assert.equal(vertUrl, "/?view=tree&dir=vertical&project=pj-1&modal=ticket&task=tsk-1&ticket=tkt-2");
  assert.deepEqual(parseRoute(vertUrl), vertRoute);

  const horizUrl = routeUrl({ view: "tree", dir: "horizontal", projectId: "pj-1" });
  assert.equal(horizUrl, "/?view=tree&dir=horizontal&project=pj-1");
  assert.equal(parseRoute(horizUrl).dir, "horizontal");

  // layout= alias is accepted by parseRoute; invalid dir values are ignored
  assert.equal(parseRoute("/?view=tree&layout=vertical&project=pj-1").dir, "vertical");
  assert.equal("dir" in parseRoute("/?view=tree&dir=diagonal&project=pj-1"), false);
  assert.equal(routeUrl({ view: "tree", dir: "diagonal", projectId: "pj-1" }), "/?view=tree&project=pj-1");
});

test("treeScene vertical layout connects bottom-center to top-center, has zero node overlaps, and centers single-lane junctions at midY", () => {
  const branchSnap = {
    project: row("pj-v", "Vertical", { name: "Vertical" }),
    tasks: [
      {
        task: row("tsk-v1", "Root Task", { status: "doing" }),
        tickets: [
          { ticket: row("tkt-root", "Root Ticket", { status: "completed" }), jobs: [] },
          { ticket: row("tkt-b1", "Branch 1", { status: "doing", depends: ["tkt-root"] }), jobs: [] },
          { ticket: row("tkt-b2", "Branch 2", { status: "todo", depends: ["tkt-root"] }), jobs: [] },
          { ticket: row("tkt-merge", "Merge Ticket", { status: "todo", depends: ["tkt-b1", "tkt-b2"] }), jobs: [] },
        ],
      },
    ],
  };

  const crossSnapshot = {
    project: row("prj-xv", "Cross Vertical", { name: "Cross Vertical" }),
    tasks: [
      {
        task: row("tsk-1", "Task 1", { status: "doing" }),
        tickets: [
          { ticket: row("a1", "A1", { status: "completed" }), jobs: [] },
          { ticket: row("b1", "B1", { status: "doing", depends: ["a1"] }), jobs: [] },
        ],
      },
      {
        task: row("tsk-2", "Task 2", { status: "doing" }),
        tickets: [
          { ticket: row("a2", "A2", { status: "doing" }), jobs: [] },
          { ticket: row("b2", "B2", { status: "todo", depends: ["a2"] }), jobs: [] },
          { ticket: row("c1", "C1", { status: "todo", depends: ["a1", "b2"] }), jobs: [] },
        ],
      },
    ],
  };

  // Single-chain vertical layout check
  const chainScene = treeScene(snapshot, { direction: "vertical" });
  assert.equal(chainScene.direction, "vertical");
  const cTask = chainScene.nodes.find(n => n.kind === "task");
  const cFirst = chainScene.nodes.find(n => n.ticketId === "tkt-1");
  const cSecond = chainScene.nodes.find(n => n.ticketId === "tkt-2");
  assert.equal(cTask.x, cFirst.x);
  assert.equal(cFirst.x, cSecond.x, "vertical chain aligns on the same X track");
  assert.ok(cFirst.y > cTask.y + cTask.height);
  assert.ok(cSecond.y > cFirst.y + cFirst.height);

  // Midpoint check on branch/merge vertical tree
  const vBranch = treeScene(branchSnap, { direction: "vertical" });
  const vById = new Map(vBranch.nodes.map(n => [n.row.record.id, n]));
  const root = vById.get("tkt-root");
  const b1 = vById.get("tkt-b1");
  const b2 = vById.get("tkt-b2");
  const merge = vById.get("tkt-merge");
  assert.equal(b1.y, b2.y, "siblings in same tier share Y");
  assert.ok(b2.x > b1.x + b1.width, "siblings do not overlap horizontally");

  const branchMidY = Math.round((root.y + root.height + b1.y) / 2);
  const mergeMidY = Math.round((b1.y + b1.height + merge.y) / 2);
  const branchJunction = vBranch.junctions.find(j => j.kind === "branch" && j.nodeId === "tkt-root");
  assert.ok(branchJunction, "expected vertical branch junction from tkt-root");
  assert.equal(branchJunction.x, root.x + TREE_METRICS.cardWidth / 2);
  assert.equal(branchJunction.y, branchMidY, "single-lane vertical branch junction Y must equal exact midpoint of tier gap");

  const mergeJunction = vBranch.junctions.find(j => j.kind === "merge" && j.nodeId === "tkt-merge");
  assert.ok(mergeJunction, "expected vertical merge junction into tkt-merge");
  assert.equal(mergeJunction.x, merge.x + TREE_METRICS.cardWidth / 2);
  assert.equal(mergeJunction.y, mergeMidY, "single-lane vertical merge junction Y must equal exact midpoint of tier gap");

  // Validate invariants across all complex vertical scenes (plus horizontal parity check)
  for (const dir of ["horizontal", "vertical"]) {
    for (const snap of [snapshot, richSnapshot, branchSnap, crossSnapshot]) {
      const sc = treeScene(snap, { direction: dir });
      assert.equal(sc.direction, dir);
      const byId = new Map(sc.nodes.map(n => [n.row.record.id, n]));

      // 1. Uniform card sizes & zero pairwise node overlaps
      for (let i = 0; i < sc.nodes.length; i++) {
        const a = sc.nodes[i];
        assert.equal(a.width, TREE_METRICS.cardWidth);
        assert.equal(a.height, TREE_METRICS.cardHeight);
        for (let j = i + 1; j < sc.nodes.length; j++) {
          const b = sc.nodes[j];
          const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
          const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
          assert.ok(!(overlapX && overlapY), `nodes ${a.row.record.id} and ${b.row.record.id} must not overlap in ${dir} mode`);
        }
      }

      // 2. Strict port-center alignment and orthogonal routing with zero card crossings
      for (const edge of sc.edges) {
        const fromNode = byId.get(edge.from);
        const toNode = byId.get(edge.to);
        assert.ok(fromNode && toNode);
        const start = edge.points[0];
        const end = edge.points[edge.points.length - 1];
        if (dir === "vertical") {
          assert.equal(start[0], fromNode.x + TREE_METRICS.cardWidth / 2, `vertical startX center for ${edge.from}->${edge.to}`);
          assert.equal(start[1], fromNode.y + TREE_METRICS.cardHeight, `vertical startY bottom edge for ${edge.from}->${edge.to}`);
          assert.equal(end[0], toNode.x + TREE_METRICS.cardWidth / 2, `vertical endX center for ${edge.from}->${edge.to}`);
          assert.equal(end[1], toNode.y, `vertical endY top edge for ${edge.from}->${edge.to}`);
        } else {
          assert.equal(start[0], fromNode.x + TREE_METRICS.cardWidth, `horizontal startX right edge for ${edge.from}->${edge.to}`);
          assert.equal(start[1], fromNode.y + TREE_METRICS.cardHeight / 2, `horizontal startY center for ${edge.from}->${edge.to}`);
          assert.equal(end[0], toNode.x, `horizontal endX left edge for ${edge.from}->${edge.to}`);
          assert.equal(end[1], toNode.y + TREE_METRICS.cardHeight / 2, `horizontal endY center for ${edge.from}->${edge.to}`);
        }

        // Every segment must be strictly orthogonal and never pass through any card interior
        for (let k = 1; k < edge.points.length; k++) {
          const [x1, y1] = edge.points[k - 1];
          const [x2, y2] = edge.points[k];
          assert.ok(x1 === x2 || y1 === y2, `segment must be orthogonal in ${dir} mode`);
          for (const card of sc.nodes) {
            if (y1 === y2) {
              const insideY = y1 > card.y && y1 < card.y + card.height;
              const overlapX = Math.max(x1, x2) > card.x && Math.min(x1, x2) < card.x + card.width;
              assert.ok(!(insideY && overlapX), `horizontal segment crossed card ${card.row.record.id} in ${dir} mode`);
            } else {
              const insideX = x1 > card.x && x1 < card.x + card.width;
              const overlapY = Math.max(y1, y2) > card.y && Math.min(y1, y2) < card.y + card.height;
              assert.ok(!(insideX && overlapY), `vertical segment crossed card ${card.row.record.id} in ${dir} mode`);
            }
          }
        }
        assert.ok(edgePathD(edge, sc.bridges).startsWith("M "));
      }

      // 3. No bridge collides with a junction
      const junctionKeys = new Set(sc.junctions.map(j => `${j.x}:${j.y}`));
      for (const b of sc.bridges) {
        assert.ok(!junctionKeys.has(`${b.x}:${b.y}`), `bridge must not overlap junction in ${dir} mode`);
      }
    }
  }
});

test("kanbanColumns clears progress when latest run.progress_changed clears progress", () => {
  const snapWithClearedProgress = {
    project: row("pj-p", "Progress PJ", { name: "Progress PJ" }),
    tasks: [
      {
        task: row("tsk-p", "Progress Task", { status: "doing" }),
        tickets: [
          {
            ticket: row("tkt-p", "Progress Ticket", { status: "doing" }),
            jobs: [row("job-p", "Progress Job", { status: "doing", runs: [{ id: "run-p", active: true }] })],
          },
        ],
      },
    ],
    timeline: [
      {
        id: 1,
        target: "run-p",
        event: "run.progress_changed",
        kind: "run",
        timestamp: "2026-11-25T01:00:00Z",
        to: { record: { id: "run-p" }, progress: { percent: 50, message: "半分完了" } },
      },
      {
        id: 2,
        target: "run-p",
        event: "run.progress_changed",
        kind: "run",
        timestamp: "2026-11-25T01:05:00Z",
        from: { record: { id: "run-p" }, progress: { percent: 50, message: "半分完了" } },
        to: { record: { id: "run-p" } },
      },
    ],
  };

  const cols = kanbanColumns(snapWithClearedProgress);
  const card = cols.find(c => c.key === "doing").cards[0];
  assert.equal(card.progress, null, "cleared progress must not resurrect an older progress event");
});

test("kanbanColumns hides unselected status columns when statuses filter is active and restores all columns when cleared", () => {
  const allKeys = ["todo", "doing", "waiting", "held", "completed", "canceled"];

  // Unspecified or empty statuses returns all 6 columns
  assert.deepEqual(kanbanColumns(richSnapshot).map(col => col.key), allKeys);
  assert.deepEqual(kanbanColumns(richSnapshot, null, { statuses: [] }).map(col => col.key), allKeys);
  assert.deepEqual(kanbanColumns(richSnapshot, null, { statuses: new Set() }).map(col => col.key), allKeys);

  // Non-status filters alone keep all 6 columns visible
  const workerOnly = kanbanColumns(richSnapshot, null, { workerId: "wkr-1" });
  assert.deepEqual(workerOnly.map(col => col.key), allKeys);
  assert.deepEqual(workerOnly.find(col => col.key === "canceled").cards, []);

  // Multi-select statuses (doing + completed) returns only those 2 columns in canonical order
  const doingCompleted = kanbanColumns(richSnapshot, null, { statuses: ["completed", "doing"] });
  assert.deepEqual(doingCompleted.map(col => col.key), ["doing", "completed"]);
  assert.deepEqual(doingCompleted[0].cards.map(c => c.ticketId), ["tkt-a3"]);
  assert.deepEqual(doingCompleted[1].cards.map(c => c.ticketId), ["tkt-a1", "tkt-a2"]);

  // Single held sub-status (paused or blocked) shows only the held column with matching tickets
  const pausedOnly = kanbanColumns(richSnapshot, null, { statuses: ["paused"] });
  assert.deepEqual(pausedOnly.map(col => col.key), ["held"]);
  assert.deepEqual(pausedOnly[0].cards.map(c => c.ticketId), ["tkt-b1"]);

  const blockedOnly = kanbanColumns(richSnapshot, null, { statuses: ["blocked"] });
  assert.deepEqual(blockedOnly.map(col => col.key), ["held"]);
  assert.deepEqual(blockedOnly[0].cards.map(c => c.ticketId), ["tkt-b2"]);

  // Combined status + worker/icon/query/workOnly filter keeps selected columns (including empty selected column) and hides unselected columns
  const combo = kanbanColumns(richSnapshot, null, {
    statuses: ["doing", "waiting"],
    workerId: "wkr-1",
  });
  assert.deepEqual(combo.map(col => col.key), ["doing", "waiting"]);
  assert.deepEqual(combo.find(col => col.key === "doing").cards.map(c => c.ticketId), ["tkt-a3"]);
  assert.deepEqual(combo.find(col => col.key === "waiting").cards, []);

  const comboWorkOnly = kanbanColumns(richSnapshot, null, {
    workOnly: true,
    statuses: ["todo", "canceled"],
    iconKeys: ["test"],
    query: "結合確認",
  });
  assert.deepEqual(comboWorkOnly.map(col => col.key), ["todo", "canceled"]);
  assert.deepEqual(comboWorkOnly.find(col => col.key === "todo").cards.map(c => c.ticketId), ["tkt-a5"]);
  assert.deepEqual(comboWorkOnly.find(col => col.key === "canceled").cards, []);
});

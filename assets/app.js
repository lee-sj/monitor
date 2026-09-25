// targets.tsv와 data/<이름>.csv를 읽어 모니터 종류(uptime, job)별로 대상 상태와 기록을 보여준다.

const TIMELINE_SIZE = 72; // 최근 확인 막대 개수

// job 응답의 작업 키를 화면에 보여줄 이름. 없으면 키를 그대로 쓴다.
const JOB_LABELS = { biddings: "입찰공고", pre_spec: "사전 규격" };

const kst = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

const count = (records, state) => records.filter((r) => r.state === state).length;
const percent = (part, total) => (total ? `${((part / total) * 100).toFixed(2)}%` : "-");

// "biddings:ok pre_spec:stale" → ["사전 규격"]
function stalledJobs(detail) {
  return (detail || "").split(" ").filter(Boolean)
    .map((pair) => pair.split(":"))
    .filter(([, status]) => status !== "ok")
    .map(([key]) => JOB_LABELS[key] ?? key);
}

// 모니터 종류별 제목, 상태 문구, 통계, 기록 표 구성
const KINDS = {
  uptime: {
    title: "Uptime Monitor",
    desc: "서버가 응답하는지 확인합니다.",
    projectLink: true,
    states: { up: "정상", cold: "콜드스타트", down: "장애" },
    legend: { up: "정상", cold: "콜드스타트 (20초 초과, 잠들었다가 깨어남)", down: "장애" },
    stats: [
      { label: "확인 횟수", value: (rs) => rs.length.toLocaleString("ko-KR") },
      { label: "가용률", value: (rs) => percent(rs.length - count(rs, "down"), rs.length) },
      { label: "콜드스타트", value: (rs) => count(rs, "cold"), tone: (rs) => count(rs, "cold") && "warn" },
      { label: "장애", value: (rs) => count(rs, "down"), tone: (rs) => count(rs, "down") && "bad" },
    ],
    eventsTitle: "콜드스타트 · 장애 기록",
    columns: ["시각", "상태", "HTTP", "응답 시간"],
    row: (r, label) => [kst.format(r.time), label, r.code, `${r.elapsed.toFixed(2)}s`],
    isEvent: (r) => r.state !== "up",
    empty: "기록 없음. keep-alive가 정상적으로 동작하고 있습니다.",
  },
  job: {
    title: "Job Monitor",
    desc: "자동 작업이 제때 성공했는지 확인합니다.",
    states: { ok: "정상", stalled: "멈춤" },
    legend: { ok: "정상", stalled: "멈춤 (정해진 시간 안에 성공 기록 없음)" },
    // 한 줄에 두 개씩 들어가는 간단한 카드
    compact: true,
    timelineSize: 36,
    eventsLimit: 3,
    stats: [
      { label: "정상 비율", value: (rs) => percent(count(rs, "ok"), rs.length) },
      { label: "멈춤 횟수", value: (rs) => count(rs, "stalled"), tone: (rs) => count(rs, "stalled") && "bad" },
      {
        label: "마지막 정상",
        value: (rs) => {
          const last = rs.findLast((r) => r.state === "ok");
          return last ? kst.format(last.time) : "-";
        },
        small: true,
      },
    ],
    eventsTitle: "멈춤 기록",
    columns: ["시각", "HTTP"],
    row: (r) => [kst.format(r.time), r.code],
    isEvent: (r) => r.state !== "ok",
    empty: "멈춤 기록 없음. 작업이 제때 성공하고 있습니다.",
  },
};

// <owner>.github.io/<repo>/에서 열리면 저장소 원본에서 직접 읽는다.
// Pages 재배포를 기다리지 않고 워크플로가 커밋한 최신 기록을 보여주기 위해서다.
// 그 밖(로컬 서버 등)에서는 같은 위치의 파일을 읽는다.
const DATA_BASE = (() => {
  const owner = location.hostname.match(/^([^.]+)\.github\.io$/)?.[1];
  const repo = location.pathname.split("/")[1];
  return owner && repo ? `https://raw.githubusercontent.com/${owner}/${repo}/master/` : "";
})();

async function fetchText(path) {
  // 브라우저 캐시를 피해서 항상 최신 파일을 읽는다
  const res = await fetch(`${DATA_BASE}${path}?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

function parseTargets(text) {
  return text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [name, url, kind] = line.split("\t");
      return { name, url, kind: KINDS[kind] ? kind : "uptime" };
    });
}

// 종류마다 열 구성이 달라서 헤더 이름으로 값을 읽는다
function parseRecords(text) {
  const [header, ...lines] = text.trim().split("\n");
  const keys = header.split(",");
  return lines
    .map((line) => {
      const row = Object.fromEntries(line.split(",").map((v, i) => [keys[i], v]));
      return {
        time: new Date(row.timestamp),
        code: row.status_code,
        elapsed: Number(row.elapsed_s),
        state: row.state,
        detail: row.detail ?? "",
      };
    })
    .filter((r) => !Number.isNaN(r.time.getTime()));
}

function renderTarget(target, records) {
  const kind = KINDS[target.kind];
  const node = document.getElementById("target-template").content.cloneNode(true);
  const $ = (sel) => node.querySelector(sel);
  const label = (state) => kind.states[state] ?? state;

  $(".target-name").textContent = target.name;
  const meta = $(".target-meta");
  meta.title = target.url; // 확인하는 URL은 마우스를 올리면 보인다
  if (kind.compact) {
    node.querySelector(".target").classList.add("compact");
  }
  if (kind.projectLink) {
    // 헬스체크 URL 대신 서비스 첫 화면(같은 도메인의 루트)으로 가는 링크를 둔다
    const link = document.createElement("a");
    link.href = new URL("/", target.url).href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "프로젝트 링크";
    meta.append(link);
  }

  const latest = records.at(-1);
  const badge = $(".badge");
  if (latest) {
    badge.textContent = label(latest.state);
    badge.classList.add(latest.state);
    const sep = meta.childNodes.length ? " · " : "";
    meta.append(`${sep}마지막 확인 ${kst.format(latest.time)}`);
  } else {
    badge.textContent = "기록 없음";
  }

  const stats = $(".stats");
  for (const stat of kind.stats) {
    const box = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = stat.label;
    dd.textContent = stat.value(records);
    const tone = stat.tone?.(records);
    if (tone) dd.classList.add(tone);
    if (stat.small) dd.classList.add("small");
    box.append(dt, dd);
    stats.append(box);
  }

  const timeline = $(".timeline");
  const timelineSize = kind.timelineSize ?? TIMELINE_SIZE;
  const recent = records.slice(-timelineSize);
  for (let i = recent.length; i < timelineSize; i++) {
    timeline.append(document.createElement("span")); // 기록이 부족한 앞부분은 빈 칸
  }
  for (const r of recent) {
    const bar = document.createElement("span");
    bar.className = r.state;
    const jobs = stalledJobs(r.detail);
    bar.title = `${kst.format(r.time)} · ${label(r.state)}${jobs.length ? ` (${jobs.join(", ")})` : ""} · HTTP ${r.code}`;
    timeline.append(bar);
  }
  const eventCount = recent.filter(kind.isEvent).length;
  timeline.setAttribute("aria-label", `최근 ${recent.length}회 확인 중 ${kind.eventsTitle.replace(" 기록", "")} ${eventCount}회`);

  $(".events-title").textContent = kind.eventsTitle;
  const headRow = $(".events thead tr");
  for (const col of kind.columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.append(th);
  }
  const events = records.filter(kind.isEvent).reverse();
  const shown = kind.eventsLimit ? events.slice(0, kind.eventsLimit) : events;
  const tbody = $(".events tbody");
  for (const r of shown) {
    const tr = document.createElement("tr");
    kind.row(r, label(r.state)).forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 1) td.className = `state-${r.state}`;
      tr.append(td);
    });
    tbody.append(tr);
  }
  if (events.length > shown.length) {
    $(".events-more").textContent = `최근 ${shown.length}건만 표시 (전체 ${events.length}건)`;
    $(".events-more").hidden = false;
  }
  if (!events.length) {
    $(".table-wrap").hidden = true;
    $(".empty-events").textContent = kind.empty;
    $(".empty-events").hidden = false;
  }

  return node;
}

function renderGroup(kindKey, targets, recordsByName) {
  const kind = KINDS[kindKey];
  const node = document.getElementById("group-template").content.cloneNode(true);
  node.querySelector(".group-title").textContent = kind.title;
  node.querySelector(".group-desc").textContent = kind.desc;

  const legend = node.querySelector(".group-legend");
  for (const [state, text] of Object.entries(kind.legend)) {
    const item = document.createElement("span");
    const swatch = document.createElement("span");
    swatch.className = `legend ${state}`;
    item.append(swatch, text);
    legend.append(item);
  }

  const list = node.querySelector(".group-targets");
  if (kind.compact) list.classList.add("compact");
  for (const target of targets) {
    list.append(renderTarget(target, recordsByName.get(target.name)));
  }
  return node;
}

async function main() {
  const container = document.getElementById("groups");
  try {
    const targetsText = await fetchText("targets.tsv");
    const targets = targetsText ? parseTargets(targetsText) : [];
    const recordsByName = new Map(await Promise.all(targets.map(async (target) => {
      const csv = await fetchText(`data/${target.name}.csv`);
      return [target.name, csv ? parseRecords(csv) : []];
    })));

    // KINDS에 정의한 순서(uptime → job)대로 섹션을 만든다
    const groups = Object.keys(KINDS)
      .map((kindKey) => [kindKey, targets.filter((t) => t.kind === kindKey)])
      .filter(([, list]) => list.length)
      .map(([kindKey, list]) => renderGroup(kindKey, list, recordsByName));

    container.replaceChildren(...groups);
    if (!groups.length) container.innerHTML = '<p class="notice">targets.tsv에 대상이 없습니다.</p>';
  } catch (err) {
    container.innerHTML = "";
    const p = document.createElement("p");
    p.className = "notice error";
    p.textContent = `불러오지 못했습니다: ${err.message}`;
    container.append(p);
  }
}

main();

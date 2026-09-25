// targets.tsv와 data/<이름>.csv를 읽어 대상별 상태와 콜드스타트·장애 기록을 보여준다.

const TIMELINE_SIZE = 72; // 최근 확인 막대 개수
const STATE_LABEL = { up: "정상", cold: "콜드스타트", down: "장애" };

const kst = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

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
      const [name, url] = line.split("\t");
      return { name, url };
    });
}

function parseRecords(text) {
  return text.trim().split("\n").slice(1)
    .map((line) => {
      const [timestamp, code, elapsed, state] = line.split(",");
      return { time: new Date(timestamp), code, elapsed: Number(elapsed), state };
    })
    .filter((r) => !Number.isNaN(r.time.getTime()));
}

function renderTarget(target, records) {
  const node = document.getElementById("target-template").content.cloneNode(true);
  const $ = (sel) => node.querySelector(sel);

  $(".target-name").textContent = target.name;
  $(".target-meta").textContent = target.url;

  const latest = records.at(-1);
  const badge = $(".badge");
  if (latest) {
    badge.textContent = STATE_LABEL[latest.state] ?? latest.state;
    badge.classList.add(latest.state);
    $(".target-meta").textContent += ` · 마지막 확인 ${kst.format(latest.time)}`;
  } else {
    badge.textContent = "기록 없음";
  }

  const count = (state) => records.filter((r) => r.state === state).length;
  const total = records.length;
  const cold = count("cold");
  const down = count("down");
  const stat = (key) => $(`[data-stat="${key}"]`);
  stat("total").textContent = total.toLocaleString("ko-KR");
  stat("availability").textContent = total ? `${(((total - down) / total) * 100).toFixed(2)}%` : "-";
  stat("cold").textContent = cold;
  stat("down").textContent = down;
  if (cold) stat("cold").classList.add("warn");
  if (down) stat("down").classList.add("bad");

  const timeline = $(".timeline");
  const recent = records.slice(-TIMELINE_SIZE);
  for (let i = recent.length; i < TIMELINE_SIZE; i++) {
    timeline.append(document.createElement("span")); // 기록이 부족한 앞부분은 빈 칸
  }
  for (const r of recent) {
    const bar = document.createElement("span");
    bar.className = r.state;
    bar.title = `${kst.format(r.time)} · ${STATE_LABEL[r.state] ?? r.state} · HTTP ${r.code} · ${r.elapsed}s`;
    timeline.append(bar);
  }
  timeline.setAttribute("aria-label", `최근 ${recent.length}회 확인 중 콜드스타트 ${recent.filter((r) => r.state === "cold").length}회, 장애 ${recent.filter((r) => r.state === "down").length}회`);

  const events = records.filter((r) => r.state !== "up").reverse();
  const tbody = $(".events tbody");
  for (const r of events) {
    const tr = document.createElement("tr");
    const cells = [kst.format(r.time), STATE_LABEL[r.state] ?? r.state, r.code, `${r.elapsed.toFixed(2)}s`];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 1) td.className = `state-${r.state}`;
      tr.append(td);
    });
    tbody.append(tr);
  }
  if (!events.length) {
    $(".table-wrap").hidden = true;
    $(".empty-events").hidden = false;
  }

  return node;
}

async function main() {
  const container = document.getElementById("targets");
  try {
    const targetsText = await fetchText("targets.tsv");
    const targets = targetsText ? parseTargets(targetsText) : [];
    const sections = await Promise.all(targets.map(async (target) => {
      const csv = await fetchText(`data/${target.name}.csv`);
      return renderTarget(target, csv ? parseRecords(csv) : []);
    }));
    container.replaceChildren(...sections);
    if (!sections.length) container.innerHTML = '<p class="notice">targets.tsv에 대상이 없습니다.</p>';
  } catch (err) {
    container.innerHTML = "";
    const p = document.createElement("p");
    p.className = "notice error";
    p.textContent = `불러오지 못했습니다: ${err.message}`;
    container.append(p);
  }
}

main();

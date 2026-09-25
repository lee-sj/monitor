#!/usr/bin/env bash
# targets.tsv의 URL을 차례로 호출하고 결과를 data/<이름>.csv에 기록한다.
# 대상 종류(세 번째 열, 없으면 uptime)에 따라 판정과 이슈 처리가 다르다.
#
# uptime: 서버가 응답하는지
#   - up / cold(20초 초과, 잠들었다가 깨어남) / down
#   - down이면 outage 이슈를 열고 복구되면 닫는다. cold는 cold-start 이슈에 기록한다.
# job: 자동 작업이 제때 성공했는지 (엔드포인트가 정상이면 200, 멈췄으면 503)
#   - ok / stalled
#   - 응답 JSON에서 작업별 status만 뽑아 detail 열에 남긴다 (예: biddings:ok pre_spec:stale)
#   - stalled면 job-stalled 이슈를 열고 재개되면 닫는다.
#
# 응답 본문은 공개 로그에 남기지 않는다. job의 detail도 정해진 status 값만 기록한다.
set -uo pipefail

COLD_THRESHOLD=20  # 초. 이보다 오래 걸리면 콜드스타트로 본다

now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }

find_issue() {  # $1=라벨 $2=대상 이름
  gh issue list --state open --label "$1" --json number,title \
    -q ".[] | select(.title | startswith(\"[$2]\")) | .number" | head -n1
}

job_detail() {  # $1=응답 본문 파일. {"<작업>": {"status": ...}} 형태만 뽑는다
  jq -r '[to_entries[] | select(.value | type == "object" and has("status"))
          | "\(.key):\(.value.status)"] | join(" ")' "$1" 2>/dev/null \
    | tr -cd 'A-Za-z0-9_:. -' | cut -c1-200
}

mkdir -p data
body=$(mktemp)
trap 'rm -f "$body"' EXIT

while IFS=$'\t' read -r name url kind <&3 || [[ -n "${name:-}" ]]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  kind=${kind:-uptime}

  ts=$(date -u +%FT%TZ)
  start=$(now)
  code=$(curl -sS -o "$body" -w '%{http_code}' \
    --max-time 90 --retry 2 --retry-delay 15 --retry-all-errors "$url" 2>/dev/null) || true
  elapsed=$(awk -v s="$start" -v e="$(now)" 'BEGIN { printf "%.2f", e - s }')
  code=${code: -3}
  code=${code:-000}
  csv="data/$name.csv"

  if [[ "$kind" == job ]]; then
    [[ "$code" == "200" ]] && state=ok || state=stalled
    detail=$(job_detail "$body")
    [[ -f "$csv" ]] || echo "timestamp,status_code,elapsed_s,state,detail" > "$csv"
    echo "$ts,$code,$elapsed,$state,$detail" >> "$csv"
    echo "$name [job]: $state (HTTP $code, ${elapsed}s) $detail"

    issue=$(find_issue job-stalled "$name")
    if [[ "$state" == stalled && -z "$issue" ]]; then
      gh issue create --label job-stalled --title "[$name] 작업 멈춤" \
        --body "시각: $ts / HTTP $code / 작업 상태: ${detail:-확인 불가} / $url"
    elif [[ "$state" == ok && -n "$issue" ]]; then
      gh issue close "$issue" --comment "재개 확인: $ts ($detail)"
    fi
    continue
  fi

  if [[ "$code" != "200" ]]; then
    state=down
  elif awk -v t="$elapsed" -v c="$COLD_THRESHOLD" 'BEGIN { exit !(t > c) }'; then
    state=cold
  else
    state=up
  fi

  [[ -f "$csv" ]] || echo "timestamp,status_code,elapsed_s,state" > "$csv"
  echo "$ts,$code,$elapsed,$state" >> "$csv"
  echo "$name: $state (HTTP $code, ${elapsed}s)"

  outage=$(find_issue outage "$name")
  if [[ "$state" == down && -z "$outage" ]]; then
    gh issue create --label outage --title "[$name] 장애 감지" \
      --body "시각: $ts / HTTP $code / 응답 ${elapsed}s / $url"
  elif [[ "$state" != down && -n "$outage" ]]; then
    gh issue close "$outage" --comment "복구 확인: $ts (HTTP $code, ${elapsed}s)"
  fi

  if [[ "$state" == cold ]]; then
    msg="$ts: 응답 ${elapsed}s. keep-alive가 멈춰 잠들었다가 이 호출로 깨어난 것으로 보임"
    cold=$(find_issue cold-start "$name")
    if [[ -n "$cold" ]]; then
      gh issue comment "$cold" --body "$msg"
    else
      gh issue create --label cold-start --title "[$name] 콜드스타트 감지" --body "$msg"
    fi
  fi
done 3< targets.tsv

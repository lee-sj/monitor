#!/usr/bin/env bash
# targets.tsv의 URL을 차례로 호출하고 결과를 data/<이름>.csv에 기록한다.
# - down: 장애 이슈를 열고, 복구되면 닫는다.
# - cold: 서버가 잠들어 있다가 이 호출로 깨어난 경우. 추적 이슈에 기록한다.
# 응답 본문은 공개 로그에 남기지 않도록 버리고 상태 코드와 응답 시간만 기록한다.
set -uo pipefail

COLD_THRESHOLD=20  # 초. 이보다 오래 걸리면 콜드스타트로 본다

now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }

find_issue() {  # $1=라벨 $2=대상 이름
  gh issue list --state open --label "$1" --json number,title \
    -q ".[] | select(.title | startswith(\"[$2]\")) | .number" | head -n1
}

mkdir -p data

while IFS=$'\t' read -r name url <&3 || [[ -n "${name:-}" ]]; do
  [[ -z "$name" || "$name" == \#* ]] && continue

  ts=$(date -u +%FT%TZ)
  start=$(now)
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    --max-time 90 --retry 2 --retry-delay 15 --retry-all-errors "$url" 2>/dev/null) || true
  elapsed=$(awk -v s="$start" -v e="$(now)" 'BEGIN { printf "%.2f", e - s }')
  code=${code: -3}
  code=${code:-000}

  if [[ "$code" != "200" ]]; then
    state=down
  elif awk -v t="$elapsed" -v c="$COLD_THRESHOLD" 'BEGIN { exit !(t > c) }'; then
    state=cold
  else
    state=up
  fi

  csv="data/$name.csv"
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

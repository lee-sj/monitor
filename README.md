# uptime-monitor

GitHub Actions로 여러 서버의 헬스체크 결과를 기록하는 저장소입니다.

## 동작

- 매시 17분에 `targets.tsv`에 있는 URL을 호출합니다. GitHub 스케줄 특성상 실제 실행은 몇 시간씩 밀릴 수 있습니다.
- 결과를 `data/<이름>.csv`에 쌓고 커밋합니다. 커밋이 계속 생기므로 60일 비활성으로 스케줄이 멈추는 것도 막아 줍니다.
- 상태 판정
  - `up`: HTTP 200, 20초 이내
  - `cold`: HTTP 200인데 20초 초과. 서버가 잠들어 있다가 이 호출로 깨어난 경우
  - `down`: 200이 아니거나 연결 실패 (최대 90초 대기, 재시도 2회)
- 이슈
  - `down`이면 `outage` 라벨로 이슈를 열고, 복구되면 자동으로 닫습니다.
  - `cold`이면 `cold-start` 라벨 이슈에 기록합니다. 확인한 뒤 직접 닫습니다.

## 상태 페이지

`index.html`과 `assets/`는 GitHub Pages로 공개되는 상태 페이지입니다. 대상별 현재 상태, 가용률, 최근 72회 확인 결과, 콜드스타트·장애 기록을 보여줍니다.

- 설정: Settings → Pages → Source를 "Deploy from a branch"로 두고 `master` / `/ (root)`를 선택합니다.
- 주소: https://lee-sj.github.io/uptime-monitor/
- Pages에서 열면 기록을 `raw.githubusercontent.com`에서 직접 읽습니다. 그래서 Pages 재배포와 관계없이 최신 커밋이 반영됩니다. 최대 5분 정도 캐시될 수 있습니다.
- 로컬 미리보기: `python3 -m http.server` 실행 후 http://localhost:8000

## 슬립 방지

슬립 방지는 이 저장소가 아니라 각 앱이 직접 담당합니다. paper는 `gunicorn.conf.py`에서 5분마다 자기 공개 URL을 호출합니다.
이 저장소는 그 장치가 멈췄을 때(`cold`) 이를 감지하고, 서버를 다시 깨우는 보조 역할을 합니다.

## 대상 추가

`targets.tsv`에 `이름<TAB>URL` 한 줄을 추가합니다. `#`으로 시작하는 줄은 무시합니다.
응답 본문은 기록하지 않지만 URL은 공개됩니다.

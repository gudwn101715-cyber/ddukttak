#!/usr/bin/env bash
set -u

DDUK_PROJECT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)" || {
  printf '%s\n' '프로젝트 폴더를 열지 못했습니다. ZIP 압축을 모두 푼 뒤 실행하세요.' >&2
  exit 1
}
cd -- "$DDUK_PROJECT_DIR" || exit 1

printf '\n%s\n\n' '무엇이든 뚝딱 - 내 컴퓨터에서 실행하기'
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js가 없습니다. https://nodejs.org/ 에서 Node.js 24 LTS를 설치한 뒤 다시 실행하세요.' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'npm을 찾을 수 없습니다. Node.js 24 LTS 설치 상태를 확인하세요.' >&2
  exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"; then
  printf '%s\n' 'Node.js 22 이상이 필요합니다. Node.js 24 LTS 설치를 권장합니다.' >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  printf '%s\n' '처음 실행에 필요한 패키지를 설치합니다. 인터넷 연결이 필요합니다.'
  npm ci --cache "$DDUK_PROJECT_DIR/.npm-cache"
  DDUK_INSTALL_EXIT=$?
  if [ "$DDUK_INSTALL_EXIT" -ne 0 ]; then
    printf '\n%s\n' '패키지 설치에 실패했습니다. 인터넷 연결과 위 오류를 확인하세요.' >&2
    printf '%s\n' '해결 후 이 폴더에서 npm ci --cache .npm-cache 를 다시 실행하세요.' >&2
    exit "$DDUK_INSTALL_EXIT"
  fi
fi

printf '\n%s\n' '서버가 준비되면 브라우저 주소창에 http://localhost:5173 을 입력하세요.'
printf '%s\n' '이 주소는 내 컴퓨터의 실행 주소입니다. 인터넷 공개 주소가 아닙니다.'
printf '%s\n\n' '사용 중에는 이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.'
npm run dev
DDUK_RUN_EXIT=$?
if [ "$DDUK_RUN_EXIT" -ne 0 ]; then
  printf '\n%s\n' '실행이 중단되었습니다. 위 오류를 확인해 주세요.' >&2
fi
exit "$DDUK_RUN_EXIT"

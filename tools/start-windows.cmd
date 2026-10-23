@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.."
if errorlevel 1 goto folder_failed

echo.
echo 무엇이든 뚝딱 - 내 컴퓨터에서 실행하기
echo.
where node >nul 2>&1
if errorlevel 1 goto node_missing
where npm >nul 2>&1
if errorlevel 1 goto npm_missing
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto node_old

if exist "node_modules" goto start_app
echo 처음 실행에 필요한 패키지를 설치합니다. 인터넷 연결이 필요합니다.
call npm ci --cache ".npm-cache"
if errorlevel 1 goto install_failed

:start_app
echo.
echo 서버가 준비되면 브라우저 주소창에 http://localhost:5173 을 입력하세요.
echo 이 주소는 내 컴퓨터의 실행 주소입니다. 인터넷 공개 주소가 아닙니다.
echo 사용 중에는 이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.
echo.
call npm run dev
set "DDUK_EXIT=%ERRORLEVEL%"
if not "%DDUK_EXIT%"=="0" echo 실행이 중단되었습니다. 위 오류를 확인해 주세요.
pause
exit /b %DDUK_EXIT%

:node_missing
echo Node.js가 없습니다. https://nodejs.org/ 에서 Node.js 24 LTS를 설치하세요.
echo 설치한 뒤 이 창을 닫고 다시 실행하세요.
pause
exit /b 1

:npm_missing
echo npm을 찾을 수 없습니다. Node.js 24 LTS 설치 상태를 확인하세요.
pause
exit /b 1

:node_old
echo Node.js 22 이상이 필요합니다. Node.js 24 LTS 설치를 권장합니다.
pause
exit /b 1

:install_failed
set "DDUK_EXIT=%ERRORLEVEL%"
echo.
echo 패키지 설치에 실패했습니다. 인터넷 연결과 위 오류를 확인하세요.
echo 해결 후 이 폴더에서 npm ci --cache .npm-cache 를 다시 실행하세요.
pause
exit /b %DDUK_EXIT%

:folder_failed
echo 프로젝트 폴더를 열지 못했습니다. ZIP 압축을 모두 푼 뒤 실행하세요.
pause
exit /b 1

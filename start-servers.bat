@echo off
set DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@localhost:5432/genbi
set AI_INTEGRATIONS_OPENAI_API_KEY=YOUR_OPENAI_API_KEY
set AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
set PORT=8080
set NODE_ENV=development

set APIDIR=C:\Users\NarasimhaVarmaManthe\Downloads\Insurance-Insight-Hub (1)\Insurance-Insight-Hub\artifacts\api-server
set FEDIR=C:\Users\NarasimhaVarmaManthe\Downloads\Insurance-Insight-Hub (1)\Insurance-Insight-Hub\artifacts\insurance-dashboard

start "API Server" /min cmd /c "cd /d "%APIDIR%" && node --enable-source-maps dist\index.mjs"
timeout /t 5 /nobreak >nul
start "Frontend" /min cmd /c "cd /d "%FEDIR%" && pnpm run dev"
echo Servers started.

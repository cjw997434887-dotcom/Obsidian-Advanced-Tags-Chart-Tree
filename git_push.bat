@echo off
set /p msg=Enter commit message:

git add .
git commit -m "%msg%"

:: 同步远程并保持历史
git pull origin main --rebase

:: 推送到远程
git push origin main

pause

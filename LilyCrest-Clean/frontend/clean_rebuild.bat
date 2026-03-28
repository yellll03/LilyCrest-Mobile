@echo off
echo === LilyCrest Full Clean Rebuild ===
echo.

echo [1/5] Killing all Node processes...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/5] Clearing metro cache...
rd /s /q "%TEMP%\metro-*" 2>nul
rd /s /q "%TEMP%\haste-map-*" 2>nul
rd /s /q "node_modules\.cache" 2>nul
echo Done.

echo [3/5] Cleaning Android build...
cd android
call gradlew clean 2>nul
cd ..
echo Done.

echo [4/5] Starting Metro with clean cache...
echo Run this command manually:
echo   npx expo start --clear
echo.
echo [5/5] Then in another terminal, run:
echo   npx expo run:android
echo.
echo === Done! ===
pause

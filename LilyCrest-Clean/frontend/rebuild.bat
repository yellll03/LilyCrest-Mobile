@echo off
echo =========================================
echo  LilyCrest Rebuild (New Arch Disabled)
echo =========================================
echo.

cd /d "c:\Users\leigh\Desktop\LilyCrest\LilyCrest-Clean\frontend"

echo [1/3] Killing Node processes...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/3] Clean prebuild...
call npx expo prebuild --clean --platform android
echo.

echo Restoring local.properties...
(echo sdk.dir=C:\\Users\\leigh\\AppData\\Local\\Android\\Sdk)> android\local.properties
echo Done.
echo.

echo [3/3] Building and installing...
call npx expo run:android

echo.
echo =========================================
echo  Build Complete!
echo =========================================
pause

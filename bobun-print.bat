@echo off
title Bobun Print Server
echo.
echo   ====================================
echo   BOBUN PRINT SERVER
echo   ====================================
echo.
echo   Impression automatique des tickets
echo   + impression depuis le dashboard
echo.
echo   Ne fermez pas cette fenetre !
echo.
node "%~dp0print-server.js" --key bobun-e233f7b3b032
echo.
echo   Le Print Server s'est arrete.
echo   Appuyez sur une touche pour relancer...
pause >nul
"%~f0"

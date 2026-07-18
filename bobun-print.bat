@echo off
title Bobun Print Agent
echo.
echo   ============================
echo   BOBUN PRINT AGENT
echo   ============================
echo.
echo   Impression automatique des tickets
echo   Ne fermez pas cette fenetre !
echo.
node "%~dp0print-agent.js" --key bobun-e233f7b3b032
echo.
echo   Le Print Agent s'est arrete.
echo   Appuyez sur une touche pour relancer...
pause >nul
"%~f0"

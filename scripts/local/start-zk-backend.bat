@echo off
echo ========================================
echo Starting ZK-STARK Python Backend
echo ========================================
echo.
echo Starting server on http://localhost:8000
echo Docs available at http://localhost:8000/docs
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

python zkp\api\server.py

@echo off
chcp 65001 >nul
echo ============================================================
echo           资产管理系统 - Docker 一键部署
echo ============================================================
echo.

REM 检查 Docker 是否运行
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Docker 未运行，请先启动 Docker Desktop
    pause
    exit /b 1
)

REM 检查 hosts 文件
findstr /C:"it.manage.com" %SystemRoot%\System32\drivers\etc\hosts >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 正在添加 hosts 记录...
    echo 127.0.0.1 it.manage.com >> %SystemRoot%\System32\drivers\etc\hosts
    echo [完成] 已添加 127.0.0.1 it.manage.com 到 hosts
) else (
    echo [OK] hosts 记录已存在
)

echo.
echo [1/3] 构建并启动所有服务...
docker compose up -d --build

if %errorlevel% neq 0 (
    echo [错误] 启动失败，请查看上方日志
    pause
    exit /b 1
)

echo.
echo [2/3] 等待数据库就绪并初始化...
timeout /t 5 /nobreak >nul
docker compose up db-init

echo.
echo [3/3] 检查服务状态...
docker compose ps

echo.
echo ============================================================
echo           部署完成！
echo ============================================================
echo.
echo   访问地址：http://it.manage.com
echo   默认账号：admin / admin123
echo.
echo   端口说明：
echo     - nginx:  80（Web访问）
echo     - mysql:  3308（数据库，避免与本地3306冲突）
echo.
echo   常用命令：
echo     查看日志：npm run docker:logs
echo     停止服务：npm run docker:down
echo     重启服务：npm run docker:restart
echo.
pause

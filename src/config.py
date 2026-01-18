import os

# 项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 数据库配置
DB_NAME = "zichan.db"
DB_DIR = os.path.join(PROJECT_ROOT, "data")
DB_PATH = os.path.join(DB_DIR, DB_NAME)

# 应用配置
APP_TITLE = "资产管理系统"
APP_VERSION = "v1.0.0 Pro"
APP_STYLE = "Fusion"

# UI 配置
WINDOW_WIDTH = 1280
WINDOW_HEIGHT = 850
SIDEBAR_WIDTH = 240
HEADER_HEIGHT = 60

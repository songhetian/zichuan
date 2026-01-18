import sys
import os
import logging

# 将项目根目录添加到 sys.path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from PySide6.QtWidgets import QApplication
from src.ui.main_window import MainWindow
from src.ui.login_window import LoginWindow
from src.config import APP_STYLE
from src.utils.logger import setup_logging

def main():
    # 初始化日志
    setup_logging()
    
    app = QApplication(sys.argv)
    
    # 全局样式优化
    app.setStyle(APP_STYLE)
    
    # 1. 显示登录窗口
    login = LoginWindow()
    
    def show_main_window(username):
        # 登录成功回调
        try:
            window = MainWindow()
            window.set_user_info(username) # 设置当前用户
            window.show()
            # 保持对 window 的引用，防止被垃圾回收
            app.main_window = window 
        except Exception as e:
            logging.error(f"Failed to show main window: {e}", exc_info=True)
    
    login.login_success.connect(show_main_window)
    login.show()
    
    # 优雅处理退出
    try:
        sys.exit(app.exec())
    except KeyboardInterrupt:
        logging.info("程序通过键盘中断强制关闭")
        sys.exit(0)

if __name__ == "__main__":
    main()

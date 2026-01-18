from PySide6.QtWidgets import (QMainWindow, QWidget, QHBoxLayout, QVBoxLayout, 
                               QListWidget, QListWidgetItem, QStackedWidget, QLabel, 
                               QFrame, QPushButton, QSpacerItem, QSizePolicy, QMessageBox, QApplication)
from PySide6.QtCore import Qt, QSize, QTimer, QDateTime
from PySide6.QtGui import QIcon, QFont, QColor

from src.ui.pages.asset_page import AssetPage
from src.ui.pages.employee_page import EmployeePage
from src.ui.pages.lifecycle_page import LifecyclePage
from src.ui.pages.dashboard_page import DashboardPage
from src.ui.pages.stocktake_page import StocktakePage
from src.ui.pages.report_page import ReportPage
from src.ui.pages.settings_page import SettingsPage
from src.ui.pages.system_log_page import SystemLogPage
from src.ui.pages.asset_stats_page import AssetStatsPage
from src.ui.pages.component_inventory_page import ComponentInventoryPage
from src.config import APP_TITLE

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(APP_TITLE)
        self.resize(1280, 850)
        self.init_base_layout()
        self.init_sidebar()
        self.init_content_area()
        self.sidebar.currentRowChanged.connect(self.switch_page)
        self.apply_styles()
        self.refresh_timer = QTimer(self)
        self.refresh_timer.timeout.connect(self.auto_refresh_current_page)
        self.refresh_timer.start(5000)
        self.sidebar.setCurrentRow(0)

    def init_base_layout(self):
        main_widget = QWidget(); self.setCentralWidget(main_widget)
        self.main_layout = QHBoxLayout(main_widget); self.main_layout.setContentsMargins(0, 0, 0, 0); self.main_layout.setSpacing(0)
        self.right_widget = QWidget(); self.right_layout = QVBoxLayout(self.right_widget); self.right_layout.setContentsMargins(0, 0, 0, 0); self.right_layout.setSpacing(0)

    def init_sidebar(self):
        self.sidebar_frame = QFrame(); self.sidebar_frame.setObjectName("sidebar"); self.sidebar_frame.setFixedWidth(240)
        layout = QVBoxLayout(self.sidebar_frame); layout.setContentsMargins(0, 0, 0, 0); layout.setSpacing(0)
        logo_box = QFrame(); logo_box.setObjectName("logo_box"); logo_box.setFixedHeight(100)
        logo_layout = QVBoxLayout(logo_box); logo_icon = QLabel("🔷"); logo_icon.setObjectName("logo_icon"); logo_icon.setAlignment(Qt.AlignCenter)
        logo_text = QLabel(APP_TITLE); logo_text.setObjectName("app_title"); logo_text.setAlignment(Qt.AlignCenter)
        logo_layout.addWidget(logo_icon); logo_layout.addWidget(logo_text); layout.addWidget(logo_box)
        self.sidebar = QListWidget(); self.sidebar.setObjectName("nav_list"); self.sidebar.setFocusPolicy(Qt.NoFocus); self.sidebar.setCursor(Qt.PointingHandCursor)
        self.sidebar.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff); self.sidebar.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.menu_items = [
            ("仪表盘", "📊", "dashboard"), ("资产统计", "📈", "statistics"), ("资产档案中心", "💻", "assets"), 
            ("配件库存管理", "🛠️", "comp_inv"), ("资产流转", "🔄", "circulation"), ("员工管理", "👥", "employee"), 
            ("配置审计", "📋", "report"), ("库存对账", "📦", "stock"), ("系统日志", "🛡️", "logs"), ("系统设置", "⚙️", "settings")
        ]
        for title, icon, _ in self.menu_items:
            item = QListWidgetItem(f"   {icon}   {title}"); item.setSizeHint(QSize(0, 60)); self.sidebar.addItem(item)
        layout.addWidget(self.sidebar, 1)
        version_label = QLabel("专业版 v1.1 Pro"); version_label.setObjectName("version_label"); version_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(version_label); layout.addSpacing(20); self.main_layout.addWidget(self.sidebar_frame)

    def init_content_area(self):
        self.header = QFrame(); self.header.setObjectName("header"); self.header.setFixedHeight(60)
        header_layout = QHBoxLayout(self.header); header_layout.setContentsMargins(20, 0, 20, 0)
        self.page_title = QLabel("仪表盘"); self.page_title.setObjectName("page_title"); header_layout.addWidget(self.page_title); header_layout.addStretch()
        self.time_label = QLabel(); self.time_label.setObjectName("header_info"); header_layout.addWidget(self.time_label)
        self.timer = QTimer(self); self.timer.timeout.connect(self.update_time); self.timer.start(1000); self.update_time()
        self.user_label = QLabel("👤 管理员: Admin"); self.user_label.setObjectName("header_info"); header_layout.addWidget(self.user_label)
        logout_btn = QPushButton("🚪 退出登录"); logout_btn.setCursor(Qt.PointingHandCursor); logout_btn.setObjectName("logout_btn"); logout_btn.clicked.connect(self.on_logout); header_layout.addWidget(logout_btn)
        self.right_layout.addWidget(self.header)
        self.content_stack = QStackedWidget(); self.content_stack.setObjectName("content_area")
        for _, _, key in self.menu_items:
            if key == "dashboard":
                dash = DashboardPage(); dash.view_all_logs.connect(lambda: self.switch_page_by_key("logs")); self.content_stack.addWidget(dash)
            elif key == "assets": self.content_stack.addWidget(AssetPage())
            elif key == "comp_inv": self.content_stack.addWidget(ComponentInventoryPage())
            elif key == "employee": self.content_stack.addWidget(EmployeePage())
            elif key == "circulation": self.content_stack.addWidget(LifecyclePage())
            elif key == "statistics": self.content_stack.addWidget(AssetStatsPage())
            elif key == "stock": self.content_stack.addWidget(StocktakePage())
            elif key == "report": self.content_stack.addWidget(ReportPage())
            elif key == "logs": self.content_stack.addWidget(SystemLogPage())
            elif key == "settings": self.content_stack.addWidget(SettingsPage())
            else: self.content_stack.addWidget(self.create_placeholder_page(key))
        self.right_layout.addWidget(self.content_stack); self.main_layout.addWidget(self.right_widget)

    def set_user_info(self, username):
        self.current_username = username; self.user_label.setText(f"👤 管理员: {username}")

    def on_logout(self):
        if QMessageBox.question(self, "确认退出", "确定要退出并重新登录吗？") == QMessageBox.Yes:
            import sys, os; os.execl(sys.executable, sys.executable, *sys.argv)

    def switch_page(self, index):
        self.content_stack.setCurrentIndex(index); self.page_title.setText(self.menu_items[index][0])
        QApplication.processEvents(); page = self.content_stack.currentWidget()
        if hasattr(page, "refresh_data"): QTimer.singleShot(10, page.refresh_data)

    def switch_page_by_key(self, key):
        for i, item in enumerate(self.menu_items):
            if item[2] == key: self.sidebar.setCurrentRow(i); break

    def jump_to_page_with_filter(self, target_key, filter_text):
        self.switch_page_by_key(target_key)
        QApplication.processEvents()
        page = self.content_stack.currentWidget()
        if hasattr(page, "s"): # 资产页的搜索框变量名是 s
            page.s.setText(filter_text)
            if hasattr(page, "load_data"): page.load_data()

    def auto_refresh_current_page(self):
        try:
            from src.database.db_manager import DBManager
            db = DBManager(); conn = db.get_connection(); cursor = conn.cursor()
            cursor.execute("SELECT id FROM users WHERE username=?", (getattr(self, 'current_username', ''),))
            exists = cursor.fetchone(); conn.close()
            if not exists: self.refresh_timer.stop(); QMessageBox.critical(self, "安全警报", "账号已失效！"); self.close(); return
            page = self.content_stack.currentWidget()
            if self.isActiveWindow() and hasattr(page, "refresh_data"): page.refresh_data()
        except: pass

    def update_time(self):
        try:
            if hasattr(self, 'time_label') and self.time_label:
                self.time_label.setText(f"🕒 {QDateTime.currentDateTime().toString('yyyy-MM-dd HH:mm')}   |   ")
        except: pass

    def create_placeholder_page(self, title):
        p = QWidget(); l = QVBoxLayout(p); c = QFrame(); c.setObjectName("content_card"); cl = QVBoxLayout(c); cl.setAlignment(Qt.AlignCenter); cl.addWidget(QLabel(f"🚧 {title} 模块开发中")); l.addWidget(c); return p

    def apply_styles(self):
        self.setStyleSheet("""
            QWidget { font-family: "Microsoft YaHei", sans-serif; font-size: 14px; }
            QFrame#sidebar { background-color: #001529; border-right: 1px solid #000; }
            QFrame#logo_box { background-color: #002140; border-bottom: 1px solid #001529; }
            QLabel#logo_icon { font-size: 24px; padding-left: 20px; }
            QLabel#app_title { color: white; font-size: 18px; font-weight: bold; padding-left: 10px; }
            QListWidget#nav_list { background-color: transparent; border: none; margin-top: 10px; }
            QListWidget#nav_list::item { color: rgba(255,255,255,0.65); height: 60px; border-left: 4px solid transparent; padding-left: 15px; }
            QListWidget#nav_list::item:selected { background-color: #1890ff; color: white; border-left: 4px solid #1890ff; font-weight: bold; }
            QListWidget#nav_list::item:hover { background-color: rgba(255,255,255,0.05); color: white; }
            QFrame#header { background-color: white; border-bottom: 1px solid #f0f0f0; }
            QLabel#page_title { font-size: 18px; font-weight: bold; color: #262626; }
            QLabel#version_label { color: rgba(255,255,255,0.3); font-size: 11px; }
            QPushButton#logout_btn { background-color: transparent; color: #ff4d4f; border: 1px solid #ff4d4f; border-radius: 2px; padding: 4px 12px; margin-left: 20px; font-size: 12px; }
            QPushButton#logout_btn:hover { background-color: #ff4d4f; color: white; }
            QStackedWidget#content_area { background-color: #f0f2f5; }
            QFrame#content_card { background-color: white; border-radius: 0px; border: 1px solid #f0f0f0; }
            QTableView { border: 1px solid #e1e4e8; selection-background-color: #1890ff; selection-color: white; alternate-background-color: #fafafa; }
            QTableView::item:selected { background-color: #1890ff; color: white; }
            QHeaderView::section { background-color: #f8f9fa; padding: 10px; border: none; border-bottom: 2px solid #e1e4e8; font-weight: bold; }
        """)

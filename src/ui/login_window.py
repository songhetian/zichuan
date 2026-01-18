from PySide6.QtWidgets import (QWidget, QVBoxLayout, QLabel, QLineEdit, 
                               QPushButton, QMessageBox, QHBoxLayout, QFrame, QCheckBox)
from PySide6.QtCore import Qt, Signal, QSettings
from src.database.db_manager import DBManager

class LoginWindow(QWidget):
    login_success = Signal(str)

    def __init__(self):
        super().__init__()
        self.setWindowTitle("资产数字化管理平台 - 登录")
        self.resize(800, 500)
        self.setFixedSize(800, 500)
        self.db = DBManager()
        self.settings = QSettings("ZichanSoft", "AssetManager") 
        self.init_ui()
        self.load_remembered_data()

    def init_ui(self):
        self.setStyleSheet("background-color: white;")
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 1. 左侧品牌区
        left_panel = QFrame()
        left_panel.setStyleSheet("""
            background-color: #1890ff;
            background-image: linear-gradient(135deg, #1890ff 0%, #001529 100%);
            border: none;
        """)
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(40, 40, 40, 40)
        
        brand_title = QLabel("资产数字化管理")
        brand_title.setStyleSheet("color: rgba(255,255,255,0.8); font-size: 14px; letter-spacing: 2px; font-weight: bold;")
        
        main_title = QLabel("企业电子设备<br>资产管理平台")
        main_title.setStyleSheet("color: white; font-size: 32px; font-weight: bold; font-family: 'Microsoft YaHei'; line-height: 1.5;")
        
        desc = QLabel("提供企业级设备全生命周期<br>的一站式解决方案。")
        desc.setStyleSheet("color: rgba(255,255,255,0.6); font-size: 13px; margin-top: 20px;")
        
        left_layout.addWidget(brand_title)
        left_layout.addSpacing(40)
        left_layout.addWidget(main_title)
        left_layout.addWidget(desc)
        left_layout.addStretch()
        
        version = QLabel("专业版 v1.1")
        version.setStyleSheet("color: rgba(255,255,255,0.4); font-size: 11px;")
        left_layout.addWidget(version)

        # 2. 右侧操作区
        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(80, 60, 80, 60)
        right_layout.setSpacing(20)

        welcome = QLabel("欢迎回来")
        welcome.setStyleSheet("font-size: 24px; font-weight: bold; color: #333; margin-bottom: 10px;")
        right_layout.addWidget(welcome)

        input_style = """
            QLineEdit {
                border: none;
                border-bottom: 1px solid #d9d9d9;
                padding: 12px 0px;
                font-size: 15px;
                background: transparent;
                color: #333;
            }
            QLineEdit:focus {
                border-bottom: 2px solid #1890ff;
            }
        """

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("请输入账号")
        self.username_input.setStyleSheet(input_style)
        right_layout.addWidget(self.username_input)

        self.password_input = QLineEdit()
        self.password_input.setPlaceholderText("请输入密码")
        self.password_input.setEchoMode(QLineEdit.Password)
        self.password_input.setStyleSheet(input_style)
        self.password_input.returnPressed.connect(self.check_login)
        right_layout.addWidget(self.password_input)

        # 记住密码勾选框
        self.remember_cb = QCheckBox("记住密码")
        self.remember_cb.setStyleSheet("color: #7f8c8d; font-size: 13px;")
        right_layout.addWidget(self.remember_cb)

        right_layout.addSpacing(10)

        self.login_btn = QPushButton("立即登录")
        self.login_btn.setCursor(Qt.PointingHandCursor)
        self.login_btn.setFixedHeight(45)
        self.login_btn.clicked.connect(self.check_login)
        self.login_btn.setStyleSheet("""
            QPushButton {
                background-color: #1890ff;
                color: white;
                border: none;
                border-radius: 2px;
                font-size: 16px;
                font-weight: bold;
            }
            QPushButton:hover { background-color: #40a9ff; }
            QPushButton:pressed { background-color: #096dd9; }
        """)
        right_layout.addWidget(self.login_btn)
        
        right_layout.addStretch()

        footer = QLabel("授权访问：仅限内部人员登录")
        footer.setAlignment(Qt.AlignCenter)
        footer.setStyleSheet("color: #bdc3c7; font-size: 11px;")
        right_layout.addWidget(footer)

        main_layout.addWidget(left_panel, 2)
        main_layout.addWidget(right_panel, 3)

    def load_remembered_data(self):
        username = self.settings.value("username", "")
        password = self.settings.value("password", "")
        remember = self.settings.value("remember", "false") == "true"
        if remember:
            self.username_input.setText(username)
            self.password_input.setText(password)
            self.remember_cb.setChecked(True)
        else:
            self.username_input.setText("admin")

    def check_login(self):
        username = self.username_input.text()
        password = self.password_input.text()
        if self.db.validate_user(username, password):
            if self.remember_cb.isChecked():
                self.settings.setValue("username", username)
                self.settings.setValue("password", password)
                self.settings.setValue("remember", "true")
            else:
                self.settings.remove("password")
                self.settings.setValue("remember", "false")
            self.login_success.emit(username)
            self.close()
        else:
            QMessageBox.critical(self, "登录失败", "用户名或密码错误")

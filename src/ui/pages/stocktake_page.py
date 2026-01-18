from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QHeaderView, QLabel, QMessageBox, QFrame)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager

class StocktakePage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.init_ui()
        self.load_history()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        
        # 顶部操作区
        header = QFrame()
        header.setObjectName("content_card")
        header_layout = QHBoxLayout(header)
        
        info = QLabel("📊 快速对账：点击按钮将根据当前资产状态自动生成一份对账快照。")
        info.setStyleSheet("color: #7f8c8d;")
        
        self.start_btn = QPushButton("🚀 开始自动盘点对账")
        self.start_btn.setMinimumHeight(45)
        self.start_btn.setStyleSheet("""
            QPushButton {
                background-color: #3498db;
                color: white;
                font-weight: bold;
                padding: 0 20px;
                border-radius: 4px;
            }
            QPushButton:hover { background-color: #2980b9; }
        """)
        self.start_btn.clicked.connect(self.run_auto_stocktake)

        header_layout.addWidget(info)
        header_layout.addStretch()
        header_layout.addWidget(self.start_btn)
        layout.addWidget(header)

        # 历史记录
        title = QLabel("🕒 盘点历史记录")
        title.setStyleSheet("font-size: 16px; font-weight: bold; margin-top: 10px;")
        layout.addWidget(title)

        self.table = QTableView()
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["任务ID", "盘点名称", "完成时间", "状态"])
        self.table.setModel(self.model)
        layout.addWidget(self.table)

    def load_history(self):
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, start_date, status FROM stocktake_sessions ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        
        self.model.removeRows(0, self.model.rowCount())
        for row in rows:
            self.model.appendRow([QStandardItem(str(f)) for f in row])

    def refresh_data(self):
        """同步多设备数据"""
        self.load_history()

    def run_auto_stocktake(self):
        import datetime
        name = f"自动盘点_{datetime.datetime.now().strftime('%Y%m%d_%H%M')}"
        
        if self.db.auto_complete_stocktake(name):
            QMessageBox.information(self, "成功", f"对账任务 '{name}' 已自动完成并归档。")
            self.load_history()
        else:
            QMessageBox.critical(self, "失败", "盘点任务创建失败")
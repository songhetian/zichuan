from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QHeaderView, QLabel, QMessageBox, QFrame, QDialog, QApplication)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager

class StocktakeDetailDialog(QDialog):
    def __init__(self, sid, name, db, parent=None):
        super().__init__(parent); self.db = db
        self.setWindowTitle(f"盘点明细报告 - {name}"); self.resize(900, 600)
        l = QVBoxLayout(self)
        self.table = QTableView(); self.table.setAlternatingRowColors(True)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["资产编号", "设备名称", "资产分类", "快照状态", "当时使用人"])
        self.table.setModel(self.model); self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        l.addWidget(self.table)
        
        # 加载明细
        details = self.db.get_stocktake_details(sid)
        for row in details:
            self.model.appendRow([QStandardItem(str(x)) for x in row])

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
        
        info = QLabel("📊 快速对账：点击按钮将抓取当前全库资产状态快照，生成对账报告。")
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
        title = QLabel("🕒 盘点历史报告 (双击查看明细)")
        title.setStyleSheet("font-size: 16px; font-weight: bold; margin-top: 10px;")
        layout.addWidget(title)

        self.table = QTableView(); self.table.setSelectionBehavior(QTableView.SelectRows)
        self.table.setEditTriggers(QTableView.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["任务ID", "盘点报告名称", "完成时间", "归档状态"])
        self.table.setModel(self.model); self.table.doubleClicked.connect(self.view_details)
        layout.addWidget(self.table)

    def view_details(self, idx):
        sid = self.model.item(idx.row(), 0).text()
        name = self.model.item(idx.row(), 1).text()
        StocktakeDetailDialog(sid, name, self.db, self).exec()

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
        name = f"全库盘点报告_{datetime.datetime.now().strftime('%Y%m%d_%H%M')}"
        
        # 禁用按钮防止重复触发
        self.start_btn.setEnabled(False)
        self.start_btn.setText("正在抓取快照并生成明细...")
        QApplication.processEvents() # 刷新 UI 避免感觉卡死
        
        if self.db.auto_complete_stocktake(name):
            QMessageBox.information(self, "成功", f"对账报告 '{name}' 已生成并归档。您可以双击记录查看资产快照。")
            self.load_history()
        else:
            QMessageBox.critical(self, "失败", "盘点任务创建失败")
        
        self.start_btn.setEnabled(True)
        self.start_btn.setText("🚀 开始自动盘点对账")
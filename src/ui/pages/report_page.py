from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLineEdit, 
                               QPushButton, QTableView, QHeaderView, QLabel)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager
from src.utils.pagination import PaginationWidget

class ReportPage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.offset = 0
        self.init_ui()
        self.load_data()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)

        header = QHBoxLayout()
        title = QLabel("📈 硬件配置升降级审计")
        title.setStyleSheet("font-size: 18px; font-weight: bold; color: #2c3e50;")
        
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("搜索资产编号/名称...")
        self.search_input.setFixedWidth(250)
        self.search_input.textChanged.connect(self.on_search_changed)

        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.search_input)
        layout.addLayout(header)

        self.table = QTableView()
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["日期", "层级", "分类", "变更类型", "详细内容"])
        self.table.setModel(self.model)
        layout.addWidget(self.table)

        self.pagination = PaginationWidget(page_size=20)
        self.pagination.page_changed.connect(self.on_page_changed)
        layout.addWidget(self.pagination)

    def load_data(self):
        total, records = self.db.get_config_history(self.search_input.text(), limit=20, offset=self.offset)
        self.model.removeRows(0, self.model.rowCount())
        for row in records:
            items = [QStandardItem(str(f)) for f in row]
            if row[3] == "升级": items[3].setForeground(Qt.darkGreen)
            elif row[3] == "降级": items[3].setForeground(Qt.red)
            self.model.appendRow(items)
        self.pagination.update_stats(total)

    def on_search_changed(self):
        self.offset = 0; self.pagination.reset(); self.load_data()

    def on_page_changed(self, offset):
        self.offset = offset; self.load_data()

    def refresh_data(self):
        self.load_data()

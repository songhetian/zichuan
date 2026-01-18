from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                               QTableView, QHeaderView, QFrame, QGridLayout, QApplication, QPushButton)
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QStandardItemModel, QStandardItem, QColor

from src.database.db_manager import DBManager

class StatBox(QFrame):
    def __init__(self, title, count, color, status_filter=None):
        super().__init__()
        self.status_filter = status_filter
        self.setFixedHeight(100); self.setMinimumWidth(200); self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet(f"QFrame {{ background-color: white; border: 1px solid #e1e4e8; }} QFrame:hover {{ background-color: #f8f9fa; border-color: {color}; }}")
        layout = QVBoxLayout(self)
        t = QLabel(title); t.setStyleSheet("color: #7f8c8d; font-size: 13px; border: none;")
        self.v = QLabel(str(count)); self.v.setStyleSheet(f"color: {color}; font-size: 30px; font-weight: bold; border: none;")
        layout.addWidget(t); layout.addWidget(self.v, 0, Qt.AlignCenter)

    def mousePressEvent(self, event):
        if self.status_filter:
            p = self.window()
            if hasattr(p, "jump_to_page_with_filter"): p.jump_to_page_with_filter("assets", self.status_filter)

    def update_val(self, val): self.v.setText(str(val))

class AssetStatsPage(QWidget):
    def __init__(self):
        super().__init__(); self.db = DBManager(); self.init_ui(); self.load_data()

    def init_ui(self):
        layout = QVBoxLayout(self); layout.setContentsMargins(25, 25, 25, 25); layout.setSpacing(20)
        
        header = QHBoxLayout()
        title = QLabel("📊 资产状态全景统计"); title.setStyleSheet("font-size: 20px; font-weight: bold; color: #2c3e50;")
        refresh_btn = QPushButton("🔄 刷新统计"); refresh_btn.clicked.connect(self.load_data)
        header.addWidget(title); header.addStretch(); header.addWidget(refresh_btn)
        layout.addLayout(header)

        # 1. 核心大盘指标
        stat_layout = QHBoxLayout()
        self.box_idle = StatBox("在库闲置", "0", "#27ae60", "闲置")
        self.box_inuse = StatBox("正在使用", "0", "#3498db", "在用")
        self.box_repair = StatBox("故障维修", "0", "#e67e22", "维修")
        self.box_scrap = StatBox("报废登记", "0", "#e74c3c", "报废")
        stat_layout.addWidget(self.box_idle); stat_layout.addWidget(self.box_inuse); stat_layout.addWidget(self.box_repair); stat_layout.addWidget(self.box_scrap)
        layout.addLayout(stat_layout)

        layout.addWidget(QLabel("📂 按分类明细查询 (点击分类名跳转详情)"))

        self.table = QTableView(); self.table.setAlternatingRowColors(True); self.table.verticalHeader().setVisible(False)
        self.table.setSortingEnabled(True); self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.setStyleSheet("QTableView { border: 1px solid #e1e4e8; } QHeaderView::section { font-weight: bold; background: #f8f9fa; }")
        self.model = QStandardItemModel(); self.model.setHorizontalHeaderLabels(["资产类别", "在库", "在用", "维修", "报废"])
        self.table.setModel(self.model); self.table.clicked.connect(self.on_cell_clicked); layout.addWidget(self.table)

    def load_data(self):
        stats = self.db.get_asset_stats_detailed(); dist = stats["status_dist"]
        self.box_idle.update_val(dist.get("闲置", 0)); self.box_inuse.update_val(dist.get("在用", 0))
        self.box_repair.update_val(dist.get("维修", 0)); self.box_scrap.update_val(dist.get("报废", 0))
        self.model.removeRows(0, self.model.rowCount())
        for row in stats["category_stats"]:
            items = [QStandardItem(str(v)) for v in row]
            for it in items: it.setTextAlignment(Qt.AlignCenter)
            self.model.appendRow(items)

    def on_cell_clicked(self, idx):
        if idx.column() == 0: # 点击分类名称跳转
            p = self.window()
            if hasattr(p, "jump_to_page_with_filter"): p.jump_to_page_with_filter("assets", self.model.item(idx.row(), 0).text())

    def refresh_data(self): self.load_data()

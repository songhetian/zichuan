from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                               QFrame, QPushButton, QListWidget, QListWidgetItem)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QCursor

from src.database.db_manager import DBManager

class StatCard(QFrame):
    def __init__(self, title, value, color="#3498db"):
        super().__init__()
        # 移除左侧边框，改为统一的细边框
        self.setStyleSheet(f"""
            QFrame {{
                background-color: white;
                border: 1px solid #e1e4e8;
                border-radius: 0px;
            }}
        """)
        self.setFixedHeight(120)
        layout = QVBoxLayout(self)
        
        title_label = QLabel(title)
        title_label.setStyleSheet("color: #7f8c8d; font-size: 13px; border: none;")
        
        self.value_label = QLabel(str(value))
        self.value_label.setStyleSheet(f"color: {color}; font-size: 32px; font-weight: bold; border: none;")
        
        layout.addWidget(title_label)
        layout.addWidget(self.value_label, 0, Qt.AlignCenter)

    def update_value(self, value):
        self.value_label.setText(str(value))

class DashboardPage(QWidget):
    view_all_logs = Signal() # 定义查看全部动态的信号

    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.init_ui()
        self.refresh_data()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(30)

        # 1. 核心指标
        card_layout = QHBoxLayout()
        self.card_total = StatCard("总资产数量", "0", "#2c3e50")
        self.card_inuse = StatCard("在用资产", "0", "#3498db")
        self.card_idle = StatCard("在库闲置", "0", "#27ae60")
        self.card_maint = StatCard("待修/故障", "0", "#e67e22")
        
        card_layout.addWidget(self.card_total)
        card_layout.addWidget(self.card_inuse)
        card_layout.addWidget(self.card_idle)
        card_layout.addWidget(self.card_maint)
        layout.addLayout(card_layout)

        # 2. 动态模块 (移除右侧快捷说明)
        log_section = QFrame()
        log_section.setStyleSheet("background-color: white; border: 1px solid #e1e4e8;")
        log_layout = QVBoxLayout(log_section)
        log_layout.setContentsMargins(20, 20, 20, 20)

        header = QHBoxLayout()
        log_title = QLabel("🕒 最近流转动态")
        log_title.setStyleSheet("font-size: 16px; font-weight: bold; color: #2c3e50; border: none;")
        
        self.all_btn = QPushButton("显示全部动态 →")
        self.all_btn.setCursor(Qt.PointingHandCursor)
        self.all_btn.setStyleSheet("""
            QPushButton { color: #3498db; border: none; font-weight: bold; }
            QPushButton:hover { text-decoration: underline; }
        """)
        self.all_btn.clicked.connect(lambda: self.view_all_logs.emit())

        header.addWidget(log_title)
        header.addStretch()
        header.addWidget(self.all_btn)
        log_layout.addLayout(header)

        self.log_list = QListWidget()
        self.log_list.setStyleSheet("border: none; background: transparent;")
        self.log_list.setSpacing(10)
        log_layout.addWidget(self.log_list)

        layout.addWidget(log_section)
        layout.addStretch()

    def refresh_data(self):
        stats = self.db.get_dashboard_stats()
        self.card_total.update_value(stats['total_count'])
        self.card_inuse.update_value(stats['in_use_count'])
        self.card_idle.update_value(stats['idle_count'])
        self.card_maint.update_value(stats['maintenance_count'])
        
        self.log_list.clear()
        activities = self.db.get_recent_activity(12)
        for date, op_type, asset, user in activities:
            user_str = f" [{user}]" if user else ""
            text = f"● {date[5:16]} | {op_type}: {asset}{user_str}"
            item = QListWidgetItem(text)
            if "领用" in op_type: item.setForeground(QColor("#3498db"))
            elif "归还" in op_type: item.setForeground(QColor("#27ae60"))
            self.log_list.addItem(item)
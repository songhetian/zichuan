from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QLineEdit, QHeaderView, QComboBox, 
                               QFormLayout, QLabel, QMessageBox, QTabWidget,
                               QTextEdit, QFrame, QAbstractItemView)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager

class LifecyclePage(QWidget):
    def __init__(self):
        super().__init__(); self.db = DBManager(); self.init_ui(); self.refresh_data()

    def init_ui(self):
        layout = QVBoxLayout(self); layout.setContentsMargins(20, 20, 20, 20)
        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("QTabWidget::pane { border: 1px solid #e1e4e8; background: white; }")
        
        self.tabs.addTab(self.create_checkout_tab(), "资产领用")
        self.tabs.addTab(self.create_return_tab(), "资产归还")
        self.tabs.addTab(self.create_log_tab(), "流转审计记录")
        self.tabs.currentChanged.connect(self.refresh_data)
        layout.addWidget(self.tabs)

    def create_checkout_tab(self):
        w = QWidget(); l = QHBoxLayout(w)
        card = QFrame(); card.setFixedWidth(500); f = QFormLayout(card)
        f.setContentsMargins(40, 40, 40, 40); f.setSpacing(25)
        self.co_a = QComboBox(); self.co_e = QComboBox(); self.co_r = QTextEdit()
        f.addRow("待领资产:", self.co_a); f.addRow("领用人员:", self.co_e); f.addRow("登记备注:", self.co_r)
        btn = QPushButton("确认领用"); btn.setFixedHeight(45); btn.clicked.connect(self.do_co)
        btn.setStyleSheet("background-color: #52c41a; color: white; font-weight: bold;")
        f.addRow(btn); l.addWidget(card); l.addStretch(); return w

    def create_return_tab(self):
        w = QWidget(); l = QHBoxLayout(w)
        card = QFrame(); card.setFixedWidth(500); f = QFormLayout(card)
        f.setContentsMargins(40, 40, 40, 40); f.setSpacing(25)
        self.rt_a = QComboBox(); self.rt_u = QLabel("..."); self.rt_r = QTextEdit()
        self.rt_a.currentIndexChanged.connect(self.on_a_change)
        f.addRow("归还资产:", self.rt_a); f.addRow("当前使用人:", self.rt_u); f.addRow("状况说明:", self.rt_r)
        btn = QPushButton("确认归还入库"); btn.setFixedHeight(45); btn.clicked.connect(self.do_rt)
        btn.setStyleSheet("background-color: #fa8c16; color: white; font-weight: bold;")
        f.addRow(btn); l.addWidget(card); l.addStretch(); return w

    def on_a_change(self):
        aid = self.rt_a.currentData()
        if aid:
            conn = self.db.get_connection(); c = conn.cursor()
            c.execute("SELECT e.name FROM assets a JOIN employees e ON a.user_id = e.id WHERE a.id=?", (aid,))
            r = c.fetchone(); self.rt_u.setText(f"👤 {r[0]}" if r else "无记录"); conn.close()

    def create_log_tab(self):
        w = QWidget(); l = QVBoxLayout(w)
        self.t = QTableView(); self.t.setAlternatingRowColors(True)
        self.t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.m = QStandardItemModel(); self.m.setHorizontalHeaderLabels(["日期", "动作", "操作员", "领用/归还人", "备注"])
        self.t.setModel(self.m); l.addWidget(self.t); return w

    def refresh_data(self):
        self.co_a.clear(); [self.co_a.addItem(f"{n}({no})", i) for i,n,no,_ in self.db.get_assets_by_status("闲置")]
        # 获取全部在职员工用于下拉框
        self.co_e.clear(); [self.co_e.addItem(f"{r[2]}({r[3]})", r[0]) for r in self.db.get_all_employees(status="在职", limit=None)]
        self.rt_a.clear(); [self.rt_a.addItem(f"{n}({no})", i) for i,n,no,_ in self.db.get_assets_by_status("在用")]
        self.m.removeRows(0, self.m.rowCount())
        conn = self.db.get_connection(); c = conn.cursor()
        c.execute("SELECT l.op_date, l.op_type, l.operator, e.name, l.remark FROM lifecycle_logs l LEFT JOIN employees e ON l.target_user_id=e.id ORDER BY l.op_date DESC")
        for r in c.fetchall(): self.m.appendRow([QStandardItem(str(x)) for x in r])
        conn.close()

    def do_co(self):
        if self.db.checkout_asset(self.co_a.currentData(), self.co_e.currentData(), "Admin", self.co_r.toPlainText()):
            QMessageBox.information(self, "成功", "已完成领用登记"); self.refresh_data()

    def do_rt(self):
        if self.db.return_asset(self.rt_a.currentData(), "Admin", self.rt_r.toPlainText()):
            QMessageBox.information(self, "成功", "已完成归还入库"); self.refresh_data()
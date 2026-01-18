from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QHeaderView, QLabel, QLineEdit, 
                               QFormLayout, QMessageBox, QDialog, QFrame, QTabWidget, QComboBox)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager

class ComponentInventoryPage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        
        title = QLabel("🛠️ 配件库与库存管理")
        title.setStyleSheet("font-size: 20px; font-weight: bold; color: #2c3e50; margin-bottom: 10px;")
        layout.addWidget(title)

        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("QTabWidget::pane { border: 1px solid #e1e4e8; }")
        
        # Tab 1: 实时库存
        self.stock_tab = QWidget()
        self.init_stock_tab()
        self.tabs.addTab(self.stock_tab, "当前配件库存")
        
        # Tab 2: 入库记录
        self.log_tab = QWidget()
        self.init_log_tab()
        self.tabs.addTab(self.log_tab, "库存变动流水")
        
        layout.addWidget(self.tabs)

    def init_stock_tab(self):
        layout = QVBoxLayout(self.stock_tab)
        
        tools = QHBoxLayout()
        self.type_filter = QComboBox()
        self.type_filter.addItems(["全部类型", "CPU", "内存", "硬盘", "显卡", "主板", "其他"])
        self.type_filter.currentIndexChanged.connect(self.load_stock)
        
        # 增加关键字搜索
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("🔍 搜具体型号...")
        self.search_input.setFixedWidth(180)
        self.search_input.textChanged.connect(self.load_stock)
        
        add_model_btn = QPushButton("+ 新增型号")
        add_model_btn.clicked.connect(self.open_add_model)
        
        add_stock_btn = QPushButton("📦 采购入库")
        add_stock_btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold;")
        add_stock_btn.clicked.connect(self.open_add_stock)
        
        tools.addWidget(QLabel("分类:")); tools.addWidget(self.type_filter)
        tools.addWidget(self.search_input)
        tools.addStretch(); tools.addWidget(add_model_btn); tools.addWidget(add_stock_btn)
        layout.addLayout(tools)

        self.stock_table = QTableView()
        # --- 核心改进：整行选中 & 高亮保持 ---
        self.stock_table.setSelectionBehavior(QTableView.SelectRows)
        self.stock_table.setSelectionMode(QTableView.SingleSelection)
        self.stock_table.setAlternatingRowColors(True)
        self.stock_table.verticalHeader().setVisible(False)
        self.stock_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        
        self.stock_model = QStandardItemModel()
        self.stock_model.setHorizontalHeaderLabels(["ID", "配件分类", "具体型号", "品牌", "当前库存余量"])
        self.stock_table.setModel(self.stock_model)
        layout.addWidget(self.stock_table)
        self.load_stock()

    def init_log_tab(self):
        layout = QVBoxLayout(self.log_tab)
        self.log_table = QTableView(); self.log_table.verticalHeader().setVisible(False)
        self.log_model = QStandardItemModel()
        self.log_model.setHorizontalHeaderLabels(["变动日期", "类型", "型号", "动作", "数量", "操作员", "备注"])
        self.log_table.setModel(self.log_model); self.log_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout.addWidget(self.log_table)

    def load_stock(self):
        # --- 核心改进：记录当前选中的 ID ---
        selected_id = None
        idx = self.stock_table.currentIndex()
        if idx.isValid() and idx.row() < self.stock_model.rowCount():
            selected_id = self.stock_model.item(idx.row(), 0).text()

        t = self.type_filter.currentText(); t = None if t == "全部类型" else t
        kw = self.search_input.text()
        
        # 获取数据 (此处沿用现有逻辑，并在DBManager支持模糊搜索)
        rows = self.db.get_all_component_models(t)
        self.stock_model.removeRows(0, self.stock_model.rowCount())
        
        for r in rows:
            if kw.lower() in str(r[2]).lower() or kw.lower() in str(r[1]).lower():
                items = [QStandardItem(str(x)) for x in r]
                for it in items: it.setTextAlignment(Qt.AlignCenter)
                # 库存低亮提醒
                if int(r[4]) < 5: items[4].setForeground(Qt.red)
                self.stock_model.appendRow(items)

        # --- 核心改进：恢复选中记忆 ---
        if selected_id:
            for r in range(self.stock_model.rowCount()):
                if self.stock_model.item(r, 0).text() == selected_id:
                    self.stock_table.selectRow(r)
                    break

    def load_logs(self):
        rows = self.db.get_component_stock_logs()
        self.log_model.removeRows(0, self.log_model.rowCount())
        for r in rows:
            items = [QStandardItem(str(x)) for x in r]
            for it in items: it.setTextAlignment(Qt.AlignCenter)
            self.log_model.appendRow(items)

    def open_add_model(self):
        if AddModelDialog(self).exec(): self.load_stock()

    def open_add_stock(self):
        idx = self.stock_table.currentIndex()
        if not idx.isValid(): 
            QMessageBox.warning(self, "提示", "请先在列表中选中一个配件型号进行入库操作。")
            return
        mid = self.stock_model.item(idx.row(), 0).text()
        name = self.stock_model.item(idx.row(), 2).text()
        if AddStockDialog(mid, name, self).exec(): 
            self.load_stock(); self.load_logs()

    def refresh_data(self):
        self.load_stock(); self.load_logs()

# --- 对话框保持原样 ---
class AddModelDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent); self.db = DBManager(); self.setWindowTitle("新增配件档案"); self.init_ui()
    def init_ui(self):
        l = QVBoxLayout(self); f = QFormLayout(); f.setSpacing(15)
        self.t = QComboBox(); self.t.addItems(["CPU", "内存", "硬盘", "显卡", "主板", "其他"])
        self.m = QLineEdit(); self.b = QLineEdit()
        f.addRow("配件类型:", self.t); f.addRow("具体型号*:", self.m); f.addRow("品牌:", self.b)
        btn = QPushButton("确认保存"); btn.setFixedHeight(40); btn.clicked.connect(self.save); l.addLayout(f); l.addWidget(btn)
    def save(self):
        if self.m.text() and self.db.add_component_model(self.t.currentText(), self.m.text(), self.b.text()): self.accept()

class AddStockDialog(QDialog):
    def __init__(self, mid, name, parent=None):
        super().__init__(parent); self.mid = mid; self.db = DBManager(); self.setWindowTitle(f"采购入库 - {name}"); self.resize(400, 300); self.init_ui()
    def init_ui(self):
        l = QVBoxLayout(self); f = QFormLayout(); f.setSpacing(20)
        self.q = QLineEdit("10"); self.r = QLineEdit()
        f.addRow("入库数量:", self.q); f.addRow("备注信息:", self.r)
        btn = QPushButton("确认入库"); btn.setFixedHeight(45); btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold;")
        btn.clicked.connect(self.save); l.addLayout(f); l.addWidget(btn)
    def save(self):
        try:
            qty = int(self.q.text())
            if self.db.add_component_stock(self.mid, qty, "Admin", self.r.text()): self.accept()
        except: QMessageBox.critical(self, "错误", "请输入有效的数字数量")
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QHeaderView, QLabel, QLineEdit, 
                               QFormLayout, QMessageBox, QDialog, QFrame, QTabWidget, QComboBox, QTextEdit)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager

class GenericManagementTab(QWidget):
    """通用管理标签：部门、分类"""
    def __init__(self, type_name, db_get, db_add, db_del):
        super().__init__()
        self.type_name = type_name; self.db_get = db_get; self.db_add = db_add; self.db_del = db_del
        self.init_ui(); self.load()

    def init_ui(self):
        layout = QVBoxLayout(self)
        add_f = QFrame(); al = QHBoxLayout(add_f)
        self.inp = QLineEdit(); self.inp.setPlaceholderText(f"新{self.type_name}名称...")
        btn = QPushButton(f"+ 新增{self.type_name}"); btn.clicked.connect(self.add)
        al.addWidget(self.inp); al.addWidget(btn); layout.addWidget(add_f)
        
        self.table = QTableView(); self.table.setAlternatingRowColors(True)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        # --- 核心修复：隐藏行号并开启排序 ---
        self.table.verticalHeader().setVisible(False)
        self.table.setSortingEnabled(True)
        
        self.table.setStyleSheet("QTableView { border: 1px solid #e1e4e8; } QHeaderView::section { font-weight: bold; background: #f8f9fa; }")
        self.model = QStandardItemModel(); self.model.setHorizontalHeaderLabels(["ID", "名称"])
        self.table.setModel(self.model); layout.addWidget(self.table)
        
        db_btn = QPushButton("🗑️ 删除选中项目"); db_btn.clicked.connect(self.delete)
        layout.addWidget(db_btn)

    def load(self):
        self.model.removeRows(0, self.model.rowCount())
        for r in self.db_get(): self.model.appendRow([QStandardItem(str(x)) for x in r])
        self.table.sortByColumn(0, Qt.AscendingOrder) # 默认正序

    def add(self):
        if self.inp.text() and self.db_add(self.inp.text()): self.inp.clear(); self.load()

    def delete(self):
        idx = self.table.currentIndex()
        if idx.isValid() and self.db_del(self.model.item(idx.row(), 0).text()): self.load()

class ComponentTemplateTab(QWidget):
    """分类配件模板配置"""
    def __init__(self, db):
        super().__init__(); self.db = db; self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        top = QHBoxLayout(); top.addWidget(QLabel("资产分类:")); self.cat = QComboBox()
        for cid, n in self.db.get_categories(): self.cat.addItem(n, cid)
        self.cat.currentIndexChanged.connect(self.load_tpl); top.addWidget(self.cat); top.addStretch()
        
        add_btn = QPushButton("+ 添加项"); add_btn.clicked.connect(self.add_row)
        del_btn = QPushButton("🗑️ 删除项"); del_btn.clicked.connect(self.del_row)
        top.addWidget(add_btn); top.addWidget(del_btn); layout.addLayout(top)

        self.table = QTableView(); self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["配件名称", "预设数量"])
        self.table.setModel(self.model); self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        # --- 核心修复：隐藏行号 ---
        self.table.verticalHeader().setVisible(False)
        layout.addWidget(self.table)
        
        save_btn = QPushButton("💾 保存模板配置"); save_btn.setFixedHeight(40)
        save_btn.setStyleSheet("background-color: #1890ff; color: white;"); save_btn.clicked.connect(self.save_tpl)
        layout.addWidget(save_btn); self.load_tpl()

    def load_tpl(self):
        self.model.removeRows(0, self.model.rowCount())
        cid = self.cat.currentData()
        if cid:
            for name, qty in self.db.get_category_components(cid):
                self.model.appendRow([QStandardItem(name), QStandardItem(str(qty))])

    def add_row(self): self.model.appendRow([QStandardItem(""), QStandardItem("1")])
    def del_row(self):
        idx = self.table.currentIndex()
        if idx.isValid(): self.model.removeRow(idx.row())

    def save_tpl(self):
        cid = self.cat.currentData(); data = []
        for r in range(self.model.rowCount()):
            n = self.model.item(r, 0).text().strip(); q = self.model.item(r, 1).text().strip() or "1"
            if n: data.append((n, int(q)))
        if self.db.update_category_components(cid, data): QMessageBox.information(self, "成功", "模板已保存。")

class SettingsPage(QWidget):
    def __init__(self):
        super().__init__(); self.db = DBManager(); self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self); layout.setContentsMargins(20, 20, 20, 20)
        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("QTabWidget::pane { border: 1px solid #e1e4e8; } QTabBar::tab { padding: 10px 20px; }")
        self.admin_tab = QWidget(); self.init_admin_tab()
        self.tabs.addTab(self.admin_tab, "管理员管理")
        self.tabs.addTab(GenericManagementTab("部门", self.db.get_departments, self.db.add_department, self.db.delete_department), "部门管理")
        self.tabs.addTab(GenericManagementTab("分类", self.db.get_categories, self.db.add_category, self.db.delete_category), "分类管理")
        self.tabs.addTab(ComponentTemplateTab(self.db), "配件项模板")
        layout.addWidget(self.tabs)

    def init_admin_tab(self):
        layout = QVBoxLayout(self.admin_tab)
        add_f = QFrame(); al = QHBoxLayout(add_f); self.u = QLineEdit(); self.p = QLineEdit(); self.p.setEchoMode(QLineEdit.Password)
        btn = QPushButton("+ 新增"); btn.clicked.connect(self.add_a); al.addWidget(self.u); al.addWidget(self.p); al.addWidget(btn); layout.addWidget(add_f)
        self.table = QTableView(); self.table.setAlternatingRowColors(True)
        # --- 核心修复：隐藏行号并开启排序 ---
        self.table.verticalHeader().setVisible(False); self.table.setSortingEnabled(True)
        self.model = QStandardItemModel(); self.model.setHorizontalHeaderLabels(["ID", "用户名", "角色"]); self.table.setModel(self.model)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch); layout.addWidget(self.table)
        btns = QHBoxLayout(); del_btn = QPushButton("🗑️ 删除"); del_btn.clicked.connect(self.del_a)
        btns.addWidget(del_btn); layout.addLayout(btns); self.load_a()

    def load_a(self):
        self.model.removeRows(0, self.model.rowCount())
        for r in self.db.get_all_admins(): self.model.appendRow([QStandardItem(str(x)) for x in r])
        self.table.sortByColumn(0, Qt.AscendingOrder)

    def add_a(self):
        if self.u.text() and self.db.add_admin(self.u.text(), self.p.text()): self.u.clear(); self.p.clear(); self.load_a()
    def del_a(self):
        idx = self.table.currentIndex()
        if idx.isValid() and self.model.item(idx.row(), 1).text() != "admin":
            if self.db.delete_admin(self.model.item(idx.row(), 0).text()): self.load_a()
    def refresh_data(self): self.load_a()
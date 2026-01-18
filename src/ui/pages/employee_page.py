from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QLineEdit, QHeaderView, QDialog, 
                               QFormLayout, QComboBox, QMessageBox, QFileDialog,
                               QAbstractItemView, QLabel)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem, QColor

from src.database.db_manager import DBManager
from src.utils.pinyin_combo import PinyinComboBox
from src.utils.pagination import PaginationWidget

class EmployeePage(QWidget):
    def __init__(self):
        super().__init__(); self.db = DBManager(); self.offset = 0; self.init_ui(); self.load_data()

    def init_ui(self):
        layout = QVBoxLayout(self); layout.setContentsMargins(20, 20, 20, 20)
        toolbar = QHBoxLayout(); toolbar.setSpacing(15)
        self.s = QLineEdit(); self.s.setPlaceholderText("🔍 快速搜索人员..."); self.s.setFixedWidth(200)
        self.dept = QComboBox(); self.dept.addItem("全部部门", None)
        for i, n in self.db.get_departments(): self.dept.addItem(n, i)
        self.st = QComboBox(); self.st.addItems(["全部状态", "在职", "离职"])
        
        add = QPushButton("+ 新增员工"); edit = QPushButton("✏️ 编辑资料")
        toolbar.addWidget(self.s); toolbar.addWidget(QLabel("部门:")); toolbar.addWidget(self.dept)
        toolbar.addWidget(QLabel("状态:")); toolbar.addWidget(self.st); toolbar.addStretch(); toolbar.addWidget(edit); toolbar.addWidget(add)
        layout.addLayout(toolbar)

        self.table = QTableView(); self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setAlternatingRowColors(True); self.table.verticalHeader().setVisible(False) # 隐藏行号
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["ID", "工号", "姓名", "所属部门", "联系方式", "在职状态"])
        self.table.setModel(self.model)
        
        self.s.textChanged.connect(self.on_search_changed)
        self.dept.currentIndexChanged.connect(self.on_search_changed)
        self.st.currentIndexChanged.connect(self.on_search_changed)
        add.clicked.connect(lambda: self.open_edit())
        edit.clicked.connect(self.on_edit_clicked)
        layout.addWidget(self.table)

        self.pagination = PaginationWidget(page_size=20)
        self.pagination.page_changed.connect(self.on_page_changed)
        layout.addWidget(self.pagination)

    def load_data(self):
        # --- 核心改进：记录当前选中的 ID ---
        selected_id = None
        idx = self.table.currentIndex()
        if idx.isValid() and idx.row() < self.model.rowCount():
            selected_id = self.model.item(idx.row(), 0).text()

        total, rows = self.db.get_all_employees(self.s.text(), self.dept.currentData(), self.st.currentText().replace("全部状态", "全部"), limit=20, offset=self.offset)
        self.model.removeRows(0, self.model.rowCount())
        for r in rows:
            items = [QStandardItem(str(x)) for x in r]
            for it in items: it.setTextAlignment(Qt.AlignCenter)
            if str(r[5]) == "在职": items[5].setForeground(QColor("#52c41a"))
            else: items[5].setForeground(QColor("#f5222d"))
            self.model.appendRow(items)
        
        self.pagination.update_stats(total)

        # --- 核心改进：恢复选中状态 ---
        if selected_id:
            for r in range(self.model.rowCount()):
                if self.model.item(r, 0).text() == selected_id:
                    self.table.selectRow(r); break

    def on_search_changed(self):
        self.offset = 0; self.pagination.reset(); self.load_data()

    def on_page_changed(self, offset):
        self.offset = offset; self.load_data()

    def open_edit(self, data=None):
        if EmployeeEditDialog(data, self).exec(): self.load_data()

    def on_edit_clicked(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            r = idx.row(); data = [self.model.item(r, i).text() for i in range(6)]
            self.open_edit(data)

    def refresh_data(self): self.load_data()

class EmployeeEditDialog(QDialog):
    def __init__(self, data=None, parent=None):
        super().__init__(parent); self.db = DBManager(); self.data = data; self.setWindowTitle("员工档案"); self.init_ui()
    def init_ui(self):
        l = QVBoxLayout(self); f = QFormLayout(); self.n = QLineEdit(); self.c = QLineEdit(); self.st = QComboBox(); self.st.addItems(["在职", "离职"])
        self.dp = PinyinComboBox(); self.dp.add_pinyin_items(self.db.get_departments())
        if self.data: 
            self.n.setText(self.data[2]); self.c.setText(self.data[4]); self.st.setCurrentText(self.data[5])
            idx = self.dp.findText(self.data[3]); self.dp.setCurrentIndex(idx)
        f.addRow("姓名*:", self.n); f.addRow("所属部门:", self.dp); f.addRow("状态:", self.st); f.addRow("联系电话:", self.c)
        l.addLayout(f); btn = QPushButton("保存"); btn.clicked.connect(self.save); l.addWidget(btn)
    def save(self):
        d = {"name": self.n.text(), "dept_id": self.dp.currentData(), "contact": self.c.text(), "status": self.st.currentText()}
        if self.data:
            if self.db.update_employee(self.data[0], d, "Admin"): self.accept()
        else:
            if self.db.add_employee(d, "Admin"): self.accept()
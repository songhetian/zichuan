from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QTableView,
    QHeaderView,
    QLabel,
    QLineEdit,
    QFormLayout,
    QMessageBox,
    QDialog,
    QFrame,
    QTabWidget,
    QComboBox,
    QTextEdit,
    QAbstractItemView,
)
from PySide6.QtCore import Qt, QPropertyAnimation, QAbstractAnimation, QEasingCurve
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager



class GenericManagementTab(QWidget):
    def __init__(self, type_name, db_get, db_add, db_del):
        super().__init__()
        self.type_name = type_name
        self.db_get = db_get
        self.db_add = db_add
        self.db_del = db_del
        self._all_rows = []
        self.init_ui()
        self.load()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        card = QFrame()
        card.setObjectName("content_card")
        card_layout = QVBoxLayout(card)

        header = QHBoxLayout()
        title = QLabel(f"{self.type_name}管理")
        title.setStyleSheet("font-size: 16px; font-weight: bold;")
        header.addWidget(title)
        header.addStretch()
        self.summary = QLabel("")
        self.summary.setStyleSheet("color: #8c8c8c; font-size: 12px;")
        header.addWidget(self.summary)
        card_layout.addLayout(header)

        toolbar = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText(f"搜索{self.type_name}...")
        self.search.setFixedWidth(200)
        self.search.textChanged.connect(self.on_search_changed)
        toolbar.addWidget(self.search)
        toolbar.addStretch()
        card_layout.addLayout(toolbar)

        add_f = QFrame()
        add_layout = QHBoxLayout(add_f)
        self.inp = QLineEdit()
        self.inp.setPlaceholderText(f"新{self.type_name}名称...")
        add_btn = QPushButton(f"+ 新增{self.type_name}")
        add_btn.clicked.connect(self.add)
        add_layout.addWidget(self.inp)
        add_layout.addWidget(add_btn)
        card_layout.addWidget(add_f)

        self.table = QTableView()
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        self.table.setSortingEnabled(True)
        self.table.setStyleSheet(
            "QTableView { border: 1px solid #e1e4e8; } QHeaderView::section { font-weight: bold; background: #f8f9fa; }"
        )
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["ID", "名称"])
        self.table.setModel(self.model)
        card_layout.addWidget(self.table)

        btn_bar = QHBoxLayout()
        delete_btn = QPushButton("🗑️ 删除选中项目")
        delete_btn.clicked.connect(self.delete)
        btn_bar.addStretch()
        btn_bar.addWidget(delete_btn)
        card_layout.addLayout(btn_bar)

        layout.addWidget(card)

    def load(self):
        self._all_rows = self.db_get()
        self.apply_filter()

    def apply_filter(self):
        self.model.removeRows(0, self.model.rowCount())
        kw = self.search.text().strip()
        for r in self._all_rows:
            if not kw or kw in str(r[1]):
                self.model.appendRow([QStandardItem(str(x)) for x in r])
        self.table.sortByColumn(0, Qt.AscendingOrder)
        self.summary.setText(f"共 {self.model.rowCount()} 个{self.type_name}")

    def on_search_changed(self):
        self.apply_filter()

    def add(self):
        text = self.inp.text().strip()
        if text and self.db_add(text):
            self.inp.clear()
            self.load()

    def delete(self):
        indexes = self.table.selectionModel().selectedRows()
        if not indexes:
            return
        failed = False
        for idx in indexes:
            if not self.db_del(self.model.item(idx.row(), 0).text()):
                failed = True
        self.load()
        if failed:
            QMessageBox.warning(
                self, "提示", f"部分{self.type_name}无法删除，可能存在关联数据。"
            )



class SettingsPage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        self.tabs = QTabWidget()
        self.tabs.setStyleSheet("""
            QTabBar::tab {
                padding: 10px 20px;
                background-color: #f0f0f0;
                border: 1px solid #e1e4e8;
                border-bottom: none;
                margin-right: 2px;
            }
            QTabBar::tab:selected {
                background-color: white;
                font-weight: bold;
                border-color: #e1e4e8;
            }
            QTabBar::tab:!selected {
                background-color: #f8f9fa;
                color: #595959;
            }
            QTabWidget::pane {
                border: 1px solid #e1e4e8;
                top: -1px;
            }
        """)
        self.admin_tab = QWidget()
        self.init_admin_tab()
        self.tabs.addTab(self.admin_tab, "管理员管理")
        self.tabs.addTab(
            GenericManagementTab(
                "部门",
                self.db.get_departments,
                self.db.add_department,
                self.db.delete_department,
            ),
            "部门管理",
        )
        self.tabs.currentChanged.connect(self.animate_current_tab)
        layout.addWidget(self.tabs)

    def animate_current_tab(self, index):
        w = self.tabs.widget(index)
        if not w:
            return
        effect = w.graphicsEffect()
        if effect is None:
            from PySide6.QtWidgets import QGraphicsOpacityEffect

            effect = QGraphicsOpacityEffect(w)
            w.setGraphicsEffect(effect)
        anim = QPropertyAnimation(effect, b"opacity", self)
        anim.setDuration(200)
        anim.setStartValue(0.0)
        anim.setEndValue(1.0)
        anim.setEasingCurve(QEasingCurve.InOutQuad)
        anim.start(QAbstractAnimation.DeleteWhenStopped)

    def init_admin_tab(self):
        layout = QVBoxLayout(self.admin_tab)
        layout.setContentsMargins(0, 0, 0, 0)
        card = QFrame()
        card.setObjectName("content_card")
        card_layout = QVBoxLayout(card)

        header = QHBoxLayout()
        title = QLabel("管理员与权限设置")
        title.setStyleSheet("font-size: 16px; font-weight: bold;")
        header.addWidget(title)
        header.addStretch()
        self.admin_summary = QLabel("")
        self.admin_summary.setStyleSheet("color: #8c8c8c; font-size: 12px;")
        header.addWidget(self.admin_summary)
        card_layout.addLayout(header)

        add_bar = QHBoxLayout()
        self.u = QLineEdit()
        self.u.setPlaceholderText("输入用户名")
        self.p = QLineEdit()
        self.p.setEchoMode(QLineEdit.Password)
        self.p.setPlaceholderText("输入初始密码")
        btn_add = QPushButton("+ 新增管理员")
        btn_add.clicked.connect(self.add_a)
        add_bar.addWidget(self.u)
        add_bar.addWidget(self.p)
        add_bar.addWidget(btn_add)
        card_layout.addLayout(add_bar)

        tools = QHBoxLayout()
        self.admin_search = QLineEdit()
        self.admin_search.setPlaceholderText("搜索用户名...")
        self.admin_search.setFixedWidth(200)
        self.admin_search.textChanged.connect(self.apply_admin_filter)
        tools.addWidget(self.admin_search)
        tools.addStretch()
        self.reset_btn = QPushButton("🔁 重置密码")
        self.reset_btn.clicked.connect(self.reset_passwords)
        self.del_btn = QPushButton("🗑️ 批量删除")
        self.del_btn.clicked.connect(self.del_a)
        tools.addWidget(self.reset_btn)
        tools.addWidget(self.del_btn)
        card_layout.addLayout(tools)

        self.table = QTableView()
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.verticalHeader().setVisible(False)
        self.table.setSortingEnabled(True)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["ID", "用户名", "角色"])
        self.table.setModel(self.model)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        card_layout.addWidget(self.table)

        layout.addWidget(card)
        self._admin_rows = []
        self.load_a()

    def load_a(self):
        self._admin_rows = self.db.get_all_admins()
        self.apply_admin_filter()

    def apply_admin_filter(self):
        self.model.removeRows(0, self.model.rowCount())
        kw = self.admin_search.text().strip() if hasattr(self, "admin_search") else ""
        for r in self._admin_rows:
            if not kw or kw in str(r[1]):
                self.model.appendRow([QStandardItem(str(x)) for x in r])
        self.table.sortByColumn(0, Qt.AscendingOrder)
        self.admin_summary.setText(f"当前管理员：{len(self._admin_rows)} 个")

    def add_a(self):
        if self.u.text() and self.db.add_admin(self.u.text(), self.p.text()):
            self.u.clear()
            self.p.clear()
            self.load_a()

    def del_a(self):
        indexes = self.table.selectionModel().selectedRows()
        if not indexes:
            return
        for idx in indexes:
            if self.model.item(idx.row(), 1).text() == "admin":
                continue
            self.db.delete_admin(self.model.item(idx.row(), 0).text())
        self.load_a()

    def reset_passwords(self):
        indexes = self.table.selectionModel().selectedRows()
        if not indexes:
            return
        for idx in indexes:
            if self.model.item(idx.row(), 1).text() == "admin":
                continue
            self.db.update_admin_password(
                self.model.item(idx.row(), 0).text(), "admin123"
            )
        QMessageBox.information(self, "成功", "已将选中账号密码重置为 admin123。")

    def refresh_data(self):
        self.load_a()

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
    QAbstractScrollArea,
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem

from src.database.db_manager import DBManager
from src.utils.pagination import PaginationWidget


class ComponentInventoryPage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.offset = 0
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)

        title = QLabel("🛠️ 配件库与库存管理")
        title.setStyleSheet(
            "font-size: 20px; font-weight: bold; color: #2c3e50; margin-bottom: 10px;"
        )
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
        self.type_filter.addItems(["全部类型"] + self.db.get_all_component_types())
        self.type_filter.currentIndexChanged.connect(self.on_filter_changed)

        self.cat_filter = QComboBox()
        self.cat_filter.addItem("全部资产分类", None)
        for cid, n in self.db.get_categories():
            self.cat_filter.addItem(n, cid)
        self.cat_filter.currentIndexChanged.connect(self.on_filter_changed)

        # 增加关键字搜索
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("🔍 搜具体型号...")
        self.search_input.setFixedWidth(180)
        self.search_input.textChanged.connect(self.on_filter_changed)

        # ... 按钮部分保持不变 ...
        add_model_btn = QPushButton("+ 新增型号")
        add_model_btn.clicked.connect(self.open_add_model)

        edit_model_btn = QPushButton("✏️ 编辑型号")
        edit_model_btn.clicked.connect(self.open_edit_model)

        add_stock_btn = QPushButton("📦 采购入库")
        add_stock_btn.setStyleSheet(
            "background-color: #1890ff; color: white; font-weight: bold;"
        )
        add_stock_btn.clicked.connect(self.open_add_stock)

        tools.addWidget(QLabel("类型:"))
        tools.addWidget(self.type_filter)
        tools.addWidget(QLabel("所属分类:"))
        tools.addWidget(self.cat_filter)
        tools.addWidget(self.search_input)
        tools.addStretch()
        tools.addWidget(add_model_btn)
        tools.addWidget(edit_model_btn)
        tools.addWidget(add_stock_btn)
        layout.addLayout(tools)

        # 创建一个容器框架来更好地控制表格高度
        table_container = QFrame()
        table_layout = QVBoxLayout(table_container)
        table_layout.setContentsMargins(0, 0, 0, 0)

        self.stock_table = QTableView()
        # ... 表格配置部分保持不变 ...
        self.stock_table.setSelectionBehavior(QTableView.SelectRows)
        self.stock_table.setSelectionMode(QTableView.SingleSelection)
        self.stock_table.setAlternatingRowColors(True)
        self.stock_table.verticalHeader().setVisible(False)
        self.stock_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.stock_table.doubleClicked.connect(self.open_edit_model)

        # 注释掉可能导致问题的尺寸策略，使用默认行为

        # 设置行高以适应更多数据
        self.stock_table.verticalHeader().setDefaultSectionSize(30)

        # 设置表格最小高度，确保可见性
        self.stock_table.setMinimumHeight(300)
        # 设置表格最大高度，防止过度扩展
        self.stock_table.setMaximumHeight(600)

        self.stock_model = QStandardItemModel()
        self.stock_model.setHorizontalHeaderLabels(
            ["ID", "配件类型", "具体型号", "品牌", "当前库存", "所属资产分类"]
        )
        self.stock_table.setModel(self.stock_model)

        table_layout.addWidget(self.stock_table)
        layout.addWidget(table_container)

        self.pagination = PaginationWidget(page_size=20)
        self.pagination.page_changed.connect(self.on_page_changed)
        layout.addWidget(self.pagination)

        # 添加弹性空间，使分页控件固定在底部
        layout.addStretch()

        self.load_stock()

    def on_page_changed(self, offset):
        self.offset = offset
        self.load_stock()

    def on_filter_changed(self):
        self.offset = 0
        if hasattr(self, "pagination"):
            self.pagination.reset()
        self.load_stock()

    def init_log_tab(self):
        layout = QVBoxLayout(self.log_tab)

        # 创建一个容器框架来更好地控制表格高度
        table_container = QFrame()
        table_layout = QVBoxLayout(table_container)
        table_layout.setContentsMargins(0, 0, 0, 0)

        self.log_table = QTableView()
        self.log_table.setAlternatingRowColors(True)
        self.log_table.verticalHeader().setVisible(False)

        # 注释掉可能导致问题的尺寸策略，使用默认行为

        # 设置行高以适应更多数据
        self.log_table.verticalHeader().setDefaultSectionSize(30)

        # 设置表格最小高度，确保可见性
        self.log_table.setMinimumHeight(300)
        # 设置表格最大高度，防止过度扩展
        self.log_table.setMaximumHeight(600)

        self.log_model = QStandardItemModel()
        self.log_model.setHorizontalHeaderLabels(
            [
                "变动日期",
                "配件类型",
                "具体型号",
                "变动动作",
                "数量",
                "操作员",
                "备注说明",
            ]
        )
        self.log_table.setModel(self.log_model)
        self.log_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)

        table_layout.addWidget(self.log_table)
        layout.addWidget(table_container)

        self.load_logs()

        # 添加弹性空间，使内容固定在合适位置
        layout.addStretch()

    def load_stock(self):
        # --- 核心改进：记录当前选中的 ID ---
        selected_id = None
        idx = self.stock_table.currentIndex()
        if idx.isValid() and idx.row() < self.stock_model.rowCount():
            selected_id = self.stock_model.item(idx.row(), 0).text()

        t = self.type_filter.currentText()
        cat_id = self.cat_filter.currentData()
        kw = self.search_input.text()

        # 获取分页数据 (传递联合筛选参数)
        total, rows = self.db.get_all_component_models(
            t, cat_id, kw, limit=20, offset=self.offset
        )
        self.stock_model.removeRows(0, self.stock_model.rowCount())

        for r in rows:
            # r 的结构: (id, type_name, model_name, brand, quantity, category_name)
            items = [QStandardItem(str(x)) for x in r]
            for it in items:
                it.setTextAlignment(Qt.AlignCenter)
            # 库存低亮提醒
            if int(r[4]) < 5:
                items[4].setForeground(Qt.red)
            self.stock_model.appendRow(items)

        self.pagination.update_stats(total)

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
            for it in items:
                it.setTextAlignment(Qt.AlignCenter)
            self.log_model.appendRow(items)

    def open_add_model(self):
        self._locked_for_dialog = True
        if AddModelDialog(self).exec():
            self.load_stock()
        self._locked_for_dialog = False

    def open_edit_model(self):
        idx = self.stock_table.currentIndex()
        if not idx.isValid():
            return

        # 获取当前行数据
        mid = int(self.stock_model.item(idx.row(), 0).text())
        row_data = {
            "type": self.stock_model.item(idx.row(), 1).text(),
            "model": self.stock_model.item(idx.row(), 2).text(),
            "brand": self.stock_model.item(idx.row(), 3).text(),
            "cat_name": self.stock_model.item(idx.row(), 5).text(),
        }

        self._locked_for_dialog = True
        if EditModelDialog(mid, row_data, self).exec():
            self.load_stock()
        self._locked_for_dialog = False

    def open_add_stock(self):
        idx = self.stock_table.currentIndex()
        if not idx.isValid():
            QMessageBox.warning(
                self, "提示", "请先在列表中选中一个配件型号进行入库操作。"
            )
            return
        mid = self.stock_model.item(idx.row(), 0).text()
        name = self.stock_model.item(idx.row(), 2).text()
        self._locked_for_dialog = True
        if AddStockDialog(mid, name, self).exec():
            self.load_stock()
            self.load_logs()
        self._locked_for_dialog = False

    def refresh_data(self):
        # 如果对话框正在打开，禁止刷新，防止数据库锁定冲突
        if getattr(self, "_locked_for_dialog", False):
            return
        self.load_stock()
        self.load_logs()


# --- 对话框 ---
class EditModelDialog(QDialog):
    def __init__(self, mid, data, parent=None):
        super().__init__(parent)
        self.db = DBManager()
        self.mid = mid
        self.setWindowTitle("编辑配件基础信息")
        self.resize(500, 450)
        self.init_ui(data)

    def init_ui(self, data):
        l = QVBoxLayout(self)
        f = QFormLayout()
        f.setSpacing(25)
        f.setContentsMargins(30, 30, 30, 30)
        self.t = QComboBox()
        self.t.addItems(self.db.get_all_component_types())
        self.t.setCurrentText(data["type"])
        self.m = QLineEdit(data["model"])
        self.b = QLineEdit(data["brand"])
        self.cat_cb = QComboBox()
        for cid, n in self.db.get_categories():
            self.cat_cb.addItem(n, cid)

        idx = self.cat_cb.findText(data["cat_name"])
        if idx >= 0:
            self.cat_cb.setCurrentIndex(idx)

        f.addRow("配件类型:", self.t)
        f.addRow("所属分类:", self.cat_cb)
        f.addRow("具体型号*:", self.m)
        f.addRow("品牌:", self.b)
        btn = QPushButton("保存修改")
        btn.setFixedHeight(45)
        btn.clicked.connect(self.save)
        l.addLayout(f)
        l.addWidget(btn)

    def save(self):
        if self.m.text() and self.db.update_component_model(
            self.mid,
            self.t.currentText(),
            self.m.text(),
            self.b.text(),
            self.cat_cb.currentData(),
        ):
            self.accept()


class AddModelDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.db = DBManager()
        self.setWindowTitle("新增配件档案")
        self.resize(500, 450)
        self.init_ui()

    def init_ui(self):
        l = QVBoxLayout(self)
        f = QFormLayout()
        f.setSpacing(25)
        f.setContentsMargins(30, 30, 30, 30)
        self.t = QComboBox()
        self.t.addItems(self.db.get_all_component_types())
        self.m = QLineEdit()
        self.b = QLineEdit()
        self.cat_cb = QComboBox()
        for cid, n in self.db.get_categories():
            self.cat_cb.addItem(n, cid)

        f.addRow("配件类型:", self.t)
        f.addRow("所属分类:", self.cat_cb)
        f.addRow("具体型号*:", self.m)
        f.addRow("品牌:", self.b)
        btn = QPushButton("确认保存")
        btn.setFixedHeight(45)
        btn.clicked.connect(self.save)
        l.addLayout(f)
        l.addWidget(btn)

    def save(self):
        if self.m.text() and self.db.add_component_model(
            self.t.currentText(),
            self.m.text(),
            self.b.text(),
            self.cat_cb.currentData(),
        ):
            self.accept()


class AddStockDialog(QDialog):
    def __init__(self, mid, name, parent=None):
        super().__init__(parent)
        self.mid = mid
        self.db = DBManager()
        self.setWindowTitle(f"采购入库 - {name}")
        self.resize(400, 300)
        self.init_ui()

    def init_ui(self):
        l = QVBoxLayout(self)
        f = QFormLayout()
        f.setSpacing(20)
        self.q = QLineEdit("10")
        self.r = QLineEdit()
        f.addRow("入库数量:", self.q)
        f.addRow("备注信息:", self.r)
        btn = QPushButton("确认入库")
        btn.setFixedHeight(45)
        btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold;")
        btn.clicked.connect(self.save)
        l.addLayout(f)
        l.addWidget(btn)

    def save(self):
        try:
            qty = int(self.q.text())
            if self.db.add_component_stock(self.mid, qty, "Admin", self.r.text()):
                self.accept()
        except:
            QMessageBox.critical(self, "错误", "请输入有效的数字数量")

from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QTableView,
    QHeaderView,
    QLabel,
    QComboBox,
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem, QColor

from src.database.db_manager import DBManager
from src.utils.pagination import PaginationWidget


class SystemLogPage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.offset = 0
        self.init_ui()
        self.load_data()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        title = QLabel("🛡️ 系统操作审计日志")
        title.setStyleSheet("font-size: 20px; font-weight: bold; color: #2c3e50;")
        layout.addWidget(title)

        search_bar = QHBoxLayout()
        search_bar.setSpacing(15)
        search_bar.addWidget(QLabel("执行人:"))
        self.user_filter = QLineEdit()
        self.user_filter.setFixedWidth(120)
        self.user_filter.textChanged.connect(self.on_search_changed)
        search_bar.addWidget(self.user_filter)
        search_bar.addWidget(QLabel("业务模块:"))
        self.module_filter = QComboBox()
        self.module_filter.addItems(
            ["全部", "资产管理", "员工管理", "流转管理", "系统设置"]
        )
        self.module_filter.currentIndexChanged.connect(self.on_search_changed)
        search_bar.addWidget(self.module_filter)
        search_bar.addWidget(QLabel("内容检索:"))
        self.keyword_filter = QLineEdit()
        self.keyword_filter.setPlaceholderText("搜资产名/动作...")
        self.keyword_filter.textChanged.connect(self.on_search_changed)
        search_bar.addWidget(self.keyword_filter)
        search_bar.addStretch()
        layout.addLayout(search_bar)

        self.table = QTableView()
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QTableView.NoEditTriggers)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(45)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(
            ["精确时间", "操作账号", "所属模块", "动作类型", "详细操作描述"]
        )
        self.table.setModel(self.model)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(
            4, QHeaderView.Interactive
        )  # 详情列可手动调整
        self.table.setColumnWidth(4, 450)

        layout.addWidget(self.table)

        self.pagination = PaginationWidget(page_size=20)
        self.pagination.page_changed.connect(self.on_page_changed)
        layout.addWidget(self.pagination)

    def load_data(self):
        total, logs = self.db.get_system_logs(
            self.user_filter.text(),
            self.module_filter.currentText(),
            self.keyword_filter.text(),
            limit=20,
            offset=self.offset,
        )
        self.model.removeRows(0, self.model.rowCount())
        for row in logs:
            # 解析和验证日志详情中的ID引用
            parsed_detail = self.parse_log_detail(row[4])

            items = [
                QStandardItem(str(row[0])),  # 精确时间
                QStandardItem(str(row[1])),  # 操作账号
                QStandardItem(str(row[2])),  # 所属模块
                QStandardItem(str(row[3])),  # 动作类型
                QStandardItem(parsed_detail),  # 解析后的详细操作描述
            ]

            # 语义化颜色增强
            action_type = str(row[3])
            if "新增" in action_type:
                items[3].setForeground(QColor("#52c41a"))
            elif "删除" in action_type:
                items[3].setForeground(QColor("#f5222d"))
            elif "修改" in action_type:
                items[3].setForeground(QColor("#fa8c16"))
            elif "分配" in action_type:
                items[3].setForeground(QColor("#1890ff"))

            # 如果详情中有无效ID引用，用特殊颜色标记
            if "❌" in parsed_detail:
                items[4].setForeground(QColor("#ff4d4f"))  # 红色标记问题
                items[4].setBackground(QColor("#fff2f0"))  # 浅红背景

            for item in items:
                item.setTextAlignment(Qt.AlignCenter)
            items[4].setTextAlignment(Qt.AlignLeft | Qt.AlignVCenter)  # 详情左对齐
            self.model.appendRow(items)
        self.pagination.update_stats(total)

    def parse_log_detail(self, detail):
        """解析日志详情，验证其中的ID引用是否有效"""
        import re

        # 查找各种ID模式
        id_patterns = [
            (r"资产ID[:\s]*(\d+)", "assets", "资产"),
            (r"员工ID[:\s]*(\d+)", "employees", "员工"),
            (r"设备ID[:\s]*(\d+)", "assets", "设备"),
            (r"分类ID[:\s]*(\d+)", "categories", "分类"),
            (r"部门ID[:\s]*(\d+)", "departments", "部门"),
            (r"ID=(\d+)", None, "通用"),  # 通用ID模式
        ]

        parsed_detail = detail
        conn = self.db.get_connection()
        c = conn.cursor()

        # 检查每种ID模式
        for pattern, table, entity_type in id_patterns:
            matches = re.finditer(pattern, detail, re.IGNORECASE)
            for match in matches:
                full_match = match.group(0)
                id_value = match.group(1)

                # 如果是通用ID模式，需要推断表名
                check_table = table
                if not check_table:
                    # 根据上下文推断表名
                    if "资产" in detail or "设备" in detail:
                        check_table = "assets"
                    elif "员工" in detail:
                        check_table = "employees"
                    elif "分类" in detail:
                        check_table = "categories"
                    elif "部门" in detail:
                        check_table = "departments"
                    else:
                        continue  # 无法推断，跳过

                # 验证ID是否存在
                try:
                    c.execute(
                        f"SELECT COUNT(*) FROM {check_table} WHERE id = ?",
                        (int(id_value),),
                    )
                    exists = c.fetchone()[0] > 0

                    if exists:
                        # ID有效，添加绿色勾号
                        replacement = f"{full_match} ✅"
                    else:
                        # ID无效，添加红色叉号和说明
                        replacement = f"{full_match} ❌({entity_type}不存在)"

                    parsed_detail = parsed_detail.replace(full_match, replacement)
                except Exception:
                    # 查询出错，标记为问题
                    replacement = f"{full_match} ❌(验证失败)"
                    parsed_detail = parsed_detail.replace(full_match, replacement)

        conn.close()
        return parsed_detail

    def on_search_changed(self):
        self.offset = 0
        self.pagination.reset()
        self.load_data()

    def on_page_changed(self, offset):
        self.offset = offset
        self.load_data()

    def refresh_data(self):
        self.load_data()

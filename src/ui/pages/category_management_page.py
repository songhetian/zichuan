from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QTreeView,
    QHeaderView,
    QLabel,
    QMessageBox,
    QFrame,
    QComboBox,
    QAbstractItemView,
    QStyledItemDelegate,
    QDialog,
    QFormLayout,
    QLineEdit,
    QTextEdit,
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem, QIntValidator
from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItemModel, QStandardItem
from src.database.db_manager import DBManager
from src.ui.widgets.loading_overlay import LoadingOverlay
from src.utils.pagination import PaginationWidget


class CategoryModelDelegate(QStyledItemDelegate):
    def __init__(self, db, get_cat_id_func, parent=None):
        super().__init__(parent)
        self.db = db
        self.get_cat_id = get_cat_id_func
        self.clear_cache()

    def clear_cache(self):
        self._type_cache = []
        self._model_cache = {}

    def createEditor(self, parent, option, index):
        from PySide6.QtCore import QTimer

        if index.column() == 0:  # 配件类型
            cb = QComboBox(parent)
            cat_id = self.get_cat_id()
            types = self.db.get_component_types_by_category(cat_id)
            cb.addItems(types)
            QTimer.singleShot(0, cb.showPopup)
            return cb
        elif index.column() == 1:  # 具体型号
            # 获取该行选中的类型名称
            type_name = index.model().index(index.row(), 0).data(Qt.DisplayRole)
            cat_id = self.get_cat_id()
            models = self.db.get_models_by_category_and_type(cat_id, type_name)

            # 核心修复：如果当前分类下没有找到该类型的型号，则显示所有该类型的型号 (兜底策略)
            if not models:
                _, models = self.db.get_all_component_models(type_name, limit=1000)

            cb = QComboBox(parent)
            cb.addItems(["未选择型号"])
            cb.setItemData(0, None)

            for item in models:
                if len(item) >= 5:
                    # 来自 get_all_component_models: (id, type, model, brand, qty, cat_name)
                    mid, _, mname, brand, stock, _ = item
                    cb.addItem(f"{mname} ({brand}) [库存:{stock}]", mid)
                else:
                    # 来自 get_models_by_category_and_type: (id, model, brand)
                    mid, mname, brand = item
                    stock = self.db.get_model_stock(mid)
                    cb.addItem(f"{mname} ({brand}) [库存:{stock}]", mid)
            QTimer.singleShot(0, cb.showPopup)
            return cb
        elif index.column() == 2:  # 预设数量
            cb = QComboBox(parent)
            cb.addItems([str(i) for i in range(1, 11)])
            QTimer.singleShot(0, cb.showPopup)
            return cb
        return super().createEditor(parent, option, index)

    def setEditorData(self, editor, index):
        if isinstance(editor, QComboBox):
            if index.column() == 1:
                mid = index.model().data(index, Qt.UserRole)
                idx = editor.findData(mid)
                if idx >= 0:
                    editor.setCurrentIndex(idx)
            else:
                cur_text = index.data(Qt.DisplayRole)
                idx = editor.findText(cur_text)
                if idx >= 0:
                    editor.setCurrentIndex(idx)
        else:
            super().setEditorData(editor, index)

    def setModelData(self, editor, model, index):
        if isinstance(editor, QComboBox):
            old_val = model.data(index, Qt.DisplayRole)
            new_val = editor.currentText()

            if index.column() == 1:  # 修改型号
                mid = editor.currentData()
                model.setData(index, new_val, Qt.DisplayRole)
                model.setData(index, mid, Qt.UserRole)
            elif index.column() == 0:  # 修改类型
                model.setData(index, new_val, Qt.DisplayRole)
                if old_val != new_val:
                    # 类型变了，强制清空型号
                    model.setData(
                        model.index(index.row(), 1), "待选型号", Qt.DisplayRole
                    )
                    model.setData(model.index(index.row(), 1), None, Qt.UserRole)
            else:
                model.setData(index, new_val, Qt.DisplayRole)
        else:
            super().setModelData(editor, model, index)


class CategoryManagementPage(QWidget):
    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.is_dirty = False
        self.page_size = 20  # 每页显示条数
        self.current_offset = 0  # 当前偏移量

        # 防抖处理：防止频繁切换分类导致卡死
        from PySide6.QtCore import QTimer

        self.load_timer = QTimer(self)
        self.load_timer.setSingleShot(True)
        self.load_timer.timeout.connect(self.load_tpl)

        # 跟踪当前正在编辑的行
        self.editing_rows = set()

        self.init_ui()

    def init_ui(self):
        # 主布局 - 增大间距，提升视觉层次
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(25)

        # 主容器 - 使用默认样式
        card = QFrame()
        card.setObjectName("content_card")  # 使用统一的卡片样式
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(30, 30, 30, 30)
        card_layout.setSpacing(25)

        # 加载遮罩
        self.overlay = LoadingOverlay(card)

        # 顶部控制栏 - 重新设计布局结构
        top_section = QVBoxLayout()
        top_section.setSpacing(20)

        # 标题区域
        title_bar = QHBoxLayout()
        title_bar.setSpacing(15)
        title_bar.setAlignment(Qt.AlignLeft)

        # 页面标题
        title_label = QLabel("📚 资产分类管理")
        title_bar.addWidget(title_label)

        # 分类选择区域
        selector_bar = QHBoxLayout()
        selector_bar.setSpacing(15)
        selector_bar.setAlignment(Qt.AlignLeft)

        # 分类选择标题
        cat_label = QLabel("📂 资产分类")
        selector_bar.addWidget(cat_label)

        # 分类下拉框 - 使用默认样式
        self.cat_cb = QComboBox()
        self.cat_cb.setFixedWidth(200)
        self.cat_cb.setMinimumHeight(36)

        # 增加全部显示选项
        self.cat_cb.addItem("全部显示", None)
        for cid, n in self.db.get_categories():
            self.cat_cb.addItem(n, cid)
        self.cat_cb.currentIndexChanged.connect(self.on_cat_changed)
        selector_bar.addWidget(self.cat_cb)

        # 库存信息显示
        self.stock_label = QLabel("📦 库存: --")
        selector_bar.addWidget(self.stock_label)

        # 增加库存按钮
        self.add_stock_btn = QPushButton("➕ 增加库存")
        self.add_stock_btn.setFixedSize(100, 36)
        self.add_stock_btn.clicked.connect(self.open_add_stock_dialog)
        selector_bar.addWidget(self.add_stock_btn)

        # 分类管理按钮
        self.add_cat_btn = QPushButton("✚ 新建分类")
        self.add_cat_btn.setFixedSize(100, 36)
        self.add_cat_btn.clicked.connect(self.create_new_category)
        selector_bar.addWidget(self.add_cat_btn)

        self.del_cat_btn = QPushButton("🗑️ 删除分类")
        self.del_cat_btn.setFixedSize(100, 36)
        self.del_cat_btn.clicked.connect(self.delete_current_category)
        selector_bar.addWidget(self.del_cat_btn)

        # 配件项管理按钮
        self.add_item_btn = QPushButton("✚ 添加配件项")
        self.add_item_btn.setFixedSize(110, 36)

        self.del_item_btn = QPushButton("— 移除配件项")
        self.del_item_btn.setFixedSize(110, 36)

        selector_bar.addWidget(self.add_item_btn)
        selector_bar.addWidget(self.del_item_btn)
        selector_bar.addStretch()

        # 组装顶部区域
        top_section.addLayout(title_bar)
        top_section.addLayout(selector_bar)

        card_layout.addLayout(top_section)

        # 数据表格展示区域 - 使用统一的全局样式
        self.tree = QTreeView()
        self.tree.setAlternatingRowColors(True)
        self.tree.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.tree.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.tree.clicked.connect(self.on_tree_clicked)
        self.tree.setSortingEnabled(True)

        # 使用与其它页面一致的默认样式（由主窗口全局样式控制）
        # 不单独设置样式，保持与其他页面的一致性

        self.model = QStandardItemModel()
        # 设置表头，操作列替换原来的ID列
        headers = ["配件类型", "预设具体型号", "预设数量", "所属资产分类", "操作"]
        self.model.setHorizontalHeaderLabels(headers)

        # 设置表头项的对齐方式
        for i, header_text in enumerate(headers):
            header_item = self.model.horizontalHeaderItem(i)
            if header_item:
                header_item.setTextAlignment(Qt.AlignCenter)
        # 实时保存模式下不需要监听模型变化标记脏数据
        # self.model.itemChanged.connect(self.set_dirty)
        # self.model.rowsInserted.connect(self.set_dirty)
        # self.model.rowsRemoved.connect(self.set_dirty)

        self.tree.setModel(self.model)
        self.tree.header().setSectionResizeMode(QHeaderView.Stretch)
        self.tree.header().setSectionResizeMode(4, QHeaderView.Fixed)  # 操作列固定宽度
        self.tree.setColumnWidth(4, 120)  # 操作列宽度

        # 设置表头文字居中
        header = self.tree.header()
        for i in range(self.model.columnCount()):
            header.setSectionResizeMode(i, QHeaderView.Stretch)
            # 设置表头项的文本对齐方式
            header_model = header.model()
            if header_model:
                header_index = header_model.index(0, i)
                header_model.setData(header_index, Qt.AlignCenter, Qt.TextAlignmentRole)

        # 应用下拉选择代理
        self.tree.setItemDelegate(
            CategoryModelDelegate(self.db, lambda: self.cat_cb.currentData(), self.tree)
        )

        card_layout.addWidget(self.tree)

        # 分页控件区域 - 使用默认样式
        self.pagination = PaginationWidget(page_size=self.page_size)
        self.pagination.page_changed.connect(self.on_page_changed)
        card_layout.addWidget(self.pagination)

        # 移除底部的全局保存按钮，改为行级实时保存
        # self.save_btn = QPushButton("💾 保存当前分类模板配置")
        # ...
        # card_layout.addWidget(self.save_btn)

        layout.addWidget(card)

        # 默认选中第一个具体分类(索引1)，而不是"全部显示"(索引0)，避免数据混淆
        if self.cat_cb.count() > 1:
            self.cat_cb.setCurrentIndex(1)
        else:
            self.cat_cb.setCurrentIndex(0)

        self.load_tpl()

    def create_new_category(self):
        from PySide6.QtWidgets import QInputDialog

        name, ok = QInputDialog.getText(
            self, "新建资产分类", "请输入分类名称（如：打印机、服务器等）:"
        )
        if ok and name.strip():
            if self.db.add_category(name.strip()):
                self.refresh_cat_list()
                QMessageBox.information(self, "成功", f"分类 [{name}] 已创建。")

    def delete_current_category(self):
        cid = self.cat_cb.currentData()
        cname = self.cat_cb.currentText()
        if not cid:
            QMessageBox.warning(self, "提示", "请先选择一个具体分类再进行删除。")
            return

        reply = QMessageBox.question(
            self,
            "确认删除",
            f"确定要永久删除分类 [{cname}] 吗？\n\n注意：如果该分类下已有资产，则无法删除。",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            if self.db.delete_category(cid):
                self.refresh_cat_list()
                QMessageBox.information(self, "成功", "分类已删除。")
            else:
                QMessageBox.warning(
                    self, "删除失败", "无法删除该分类，可能已有资产关联或数据库受限。"
                )

    def refresh_cat_list(self):
        self.cat_cb.blockSignals(True)
        self.cat_cb.clear()
        self.cat_cb.addItem("全部显示", None)
        for cid, n in self.db.get_categories():
            self.cat_cb.addItem(n, cid)
        self.cat_cb.blockSignals(False)
        self.load_tpl()

    # 删除 set_dirty 方法，因为是实时保存
    # def set_dirty(self): ...

    def on_tree_clicked(self, index):
        """处理单击事件：只有在编辑模式下的行才允许编辑"""
        if not index.isValid():
            return
        if index.row() in self.editing_rows:
            self.tree.edit(index)

    def create_edit_button(self, row):
        """为指定行创建编辑/保存按钮 - 使用默认样式"""
        from PySide6.QtWidgets import QWidget, QHBoxLayout

        widget = QWidget()
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(8)

        # 编辑按钮
        edit_btn = QPushButton("✎ 编辑")
        edit_btn.setCursor(Qt.PointingHandCursor)
        edit_btn.setFixedSize(60, 28)
        edit_btn.clicked.connect(lambda: self.enable_row_edit(row))

        # 保存按钮
        save_btn = QPushButton("✓ 保存")
        save_btn.setCursor(Qt.PointingHandCursor)
        save_btn.setFixedSize(60, 28)
        save_btn.clicked.connect(lambda: self.disable_row_edit(row))
        save_btn.setVisible(False)  # 默认隐藏保存按钮

        layout.addWidget(edit_btn)
        layout.addWidget(save_btn)
        layout.addStretch()

        return widget

    def enable_row_edit(self, row):
        """启用指定行的编辑模式"""
        self.editing_rows.add(row)

        # 设置前3列可编辑
        for col in range(3):
            item = self.model.item(row, col)
            if item:
                item.setEditable(True)

        # 切换按钮显示
        widget = self.tree.indexWidget(self.model.index(row, 4))
        if widget:
            edit_btn = widget.findChild(QPushButton, "", Qt.FindDirectChildrenOnly)
            save_btn = widget.findChildren(QPushButton, "", Qt.FindDirectChildrenOnly)[
                1
            ]
            if edit_btn and save_btn:
                edit_btn.setVisible(False)
                save_btn.setVisible(True)

    def disable_row_edit(self, row):
        """禁用指定行的编辑模式并自动保存"""
        self.editing_rows.discard(row)

        # 设置前3列不可编辑
        for col in range(3):
            item = self.model.item(row, col)
            if item:
                item.setEditable(False)

        # 切换按钮显示
        widget = self.tree.indexWidget(self.model.index(row, 4))
        if widget:
            edit_btn = widget.findChild(QPushButton, "", Qt.FindDirectChildrenOnly)
            save_btn = widget.findChildren(QPushButton, "", Qt.FindDirectChildrenOnly)[
                1
            ]
            if edit_btn and save_btn:
                edit_btn.setVisible(True)
                save_btn.setVisible(False)

        # 触发实时保存
        self.save_current_data()

    def save_current_data(self):
        """保存当前数据到数据库"""
        cid = self.cat_cb.currentData()
        if not cid:
            return

        try:
            final_data = []
            for r in range(self.model.rowCount()):
                item_name = self.model.item(r, 0)
                if not item_name:
                    continue
                name = item_name.text()

                if not name or name == "请选择类型":
                    continue

                item_qty = self.model.item(r, 2)
                item_model = self.model.item(r, 1)

                qty = item_qty.text() if item_qty else "1"
                mid = item_model.data(Qt.UserRole) if item_model else None

                final_data.append({"name": name, "qty": qty, "model_id": mid})

            if self.db.update_category_components(cid, final_data):
                # 保存成功但不弹窗打扰用户，除非失败
                pass
            else:
                QMessageBox.warning(self, "保存失败", "数据保存失败，请检查。")
        except Exception as e:
            QMessageBox.critical(self, "错误", f"保存异常: {str(e)}")

    def on_cat_changed(self):
        # 实时保存模式下不需要检查脏数据，切换即视为放弃未保存的新增行
        # if self.is_dirty: ...

        # CRITICAL FIX: Stop any pending load operation to prevent race conditions

        # CRITICAL FIX: Stop any pending load operation to prevent race conditions
        self.load_timer.stop()

        self.editing_rows.clear()  # Clear editing state

        # CRITICAL FIX: Clear model immediately to prevent data retention
        self.model.blockSignals(True)
        self.model.clear()  # Use clear() instead of removeRows for complete reset
        self.model.setHorizontalHeaderLabels(
            ["配件类型", "预设具体型号", "预设数量", "所属资产分类", "操作"]
        )
        self.model.blockSignals(False)

        # Clear delegate cache immediately
        if hasattr(self.tree.itemDelegate(), "clear_cache"):
            self.tree.itemDelegate().clear_cache()

        # 更新当前分类的库存显示
        self.update_stock_display()

        # 更新增加库存按钮状态
        self.update_add_stock_button_state()

        # Then start debounced load
        self.load_timer.start(200)

    def update_stock_display(self):
        """更新当前分类的库存显示"""
        cid = self.cat_cb.currentData()
        if cid is not None:
            stock = self.db.get_category_stock(cid)
            # 根据库存数量设置不同的颜色
            if stock > 50:
                color = "#10b981"  # 绿色
                bg_color = "#ecfdf5"
                border_color = "#bbf7d0"
            elif stock > 20:
                color = "#f59e0b"  # 黄色
                bg_color = "#fffbeb"
                border_color = "#fef3c7"
            elif stock > 0:
                color = "#f97316"  # 橙色
                bg_color = "#fff7ed"
                border_color = "#fed7aa"
            else:
                color = "#ef4444"  # 红色
                bg_color = "#fef2f2"
                border_color = "#fecaca"

            self.stock_label.setText(f"📦 库存: {stock}")
            self.stock_label.setStyleSheet(
                f"""
                QLabel {{
                    font-size: 14px;
                    font-weight: 600;
                    color: {color};
                    background-color: {bg_color};
                    padding: 10px 20px;
                    border-radius: 20px;
                    min-width: 120px;
                    text-align: center;
                    border: 1px solid {border_color};
                }}
                """
            )

            # 如果库存不足，禁用添加资产按钮
            self.add_item_btn.setEnabled(stock > 0 and cid is not None)
        else:
            self.stock_label.setText("📦 库存: --")
            self.stock_label.setStyleSheet(
                """
                QLabel {
                    font-size: 14px;
                    font-weight: 600;
                    color: #3b82f6;
                    background-color: #eff6ff;
                    padding: 10px 20px;
                    border-radius: 20px;
                    min-width: 120px;
                    text-align: center;
                    border: 1px solid #bfdbfe;
                }
                """
            )

    def update_add_stock_button_state(self):
        """更新增加库存按钮状态"""
        cid = self.cat_cb.currentData()
        # 只有选择了具体分类时才能增加库存
        self.add_stock_btn.setEnabled(cid is not None)

    def load_tpl(self):
        self.is_dirty = False

        # Model already cleared in on_cat_changed(), just load data
        self.model.blockSignals(True)

        cid = self.cat_cb.currentData()
        is_all_mode = cid is None

        # 联动 UI 状态
        self.add_item_btn.setEnabled(not is_all_mode)
        self.del_item_btn.setEnabled(not is_all_mode)
        self.del_cat_btn.setEnabled(not is_all_mode)
        self.tree.setColumnHidden(3, not is_all_mode)  # 全局预览时显示分类列

        # 获取所有数据
        all_data = self.db.get_category_components(cid)

        # 更新分页统计信息
        total_count = len(all_data)
        self.pagination.update_stats(total_count)

        # 计算当前页数据范围
        start_idx = self.current_offset
        end_idx = min(start_idx + self.page_size, total_count)
        data = all_data[start_idx:end_idx]
        # data 结构: (db_id, parent_id, name, qty, mid, mname, stock, cat_name)
        for db_id, _, name, qty, mid, mname, _, cat_name in data:
            item_name = QStandardItem(name)
            item_name.setTextAlignment(Qt.AlignCenter)
            item_name.setEditable(False)

            item_model = QStandardItem(mname or "未选择型号")
            item_model.setData(mid, Qt.UserRole)
            item_model.setTextAlignment(Qt.AlignCenter)
            item_model.setEditable(False)

            item_qty = QStandardItem(str(qty))
            item_qty.setTextAlignment(Qt.AlignCenter)
            item_qty.setEditable(False)

            item_cat = QStandardItem(cat_name)
            item_cat.setEditable(False)
            item_cat.setTextAlignment(Qt.AlignCenter)

            item_op = QStandardItem("")  # 操作列占位
            item_op.setEditable(False)

            # 添加行，只包含5列（不含ID列）
            self.model.appendRow([item_name, item_model, item_qty, item_cat, item_op])

            # 为操作列添加按钮控件
            row_idx = self.model.rowCount() - 1
            self.tree.setIndexWidget(
                self.model.index(row_idx, 4), self.create_edit_button(row_idx)
            )

        self.model.blockSignals(False)

    def add_item(self):
        new_name = QStandardItem("请选择类型")
        new_name.setTextAlignment(Qt.AlignCenter)
        new_model = QStandardItem("待选型号")
        new_model.setTextAlignment(Qt.AlignCenter)
        new_qty = QStandardItem("1")
        new_qty.setTextAlignment(Qt.AlignCenter)
        new_cat = QStandardItem("-")
        new_cat.setTextAlignment(Qt.AlignCenter)
        new_op = QStandardItem("")  # 操作列占位
        new_op.setEditable(False)

        self.model.appendRow([new_name, new_model, new_qty, new_cat, new_op])

        # 为新行添加按钮并自动进入编辑模式
        row_idx = self.model.rowCount() - 1
        self.tree.setIndexWidget(
            self.model.index(row_idx, 4), self.create_edit_button(row_idx)
        )
        self.enable_row_edit(row_idx)  # 新增项自动进入编辑模式

    def del_item(self):
        indices = self.tree.selectionModel().selectedRows()
        if not indices:
            return

        if (
            QMessageBox.question(
                self,
                "确人移除",
                "确定要移除选中的配件项吗？移除后将自动保存。",
                QMessageBox.Yes | QMessageBox.No,
            )
            == QMessageBox.Yes
        ):
            self.model.removeRow(indices[0].row())
            self.save_current_data()

    # delete save_tpl method

    # save_tpl removed

    def on_page_changed(self, offset):
        """处理分页改变事件"""
        self.current_offset = offset
        self.load_tpl()

    def open_add_stock_dialog(self):
        """打开增加库存对话框"""
        cid = self.cat_cb.currentData()
        cname = self.cat_cb.currentText()
        if not cid:
            QMessageBox.warning(self, "提示", "请先选择一个具体分类。")
            return

        dialog = AddStockDialog(cid, cname, self)
        if dialog.exec():
            # 增加库存成功后刷新显示
            self.update_stock_display()
            self.update_add_stock_button_state()
            QMessageBox.information(self, "成功", f"分类 [{cname}] 库存增加成功！")

    def refresh_data(self):
        # 如果当前有未保存的修改，跳过主窗口的自动定时刷新，防止数据被覆盖
        if self.is_dirty:
            return

        cur_id = self.cat_cb.currentData()

        # 阻断信号，防止 refresh_cat_list 触发重复的 load_tpl
        self.cat_cb.blockSignals(True)
        self.refresh_cat_list()
        idx = self.cat_cb.findData(cur_id)
        if idx != -1:
            self.cat_cb.setCurrentIndex(idx)
        self.cat_cb.blockSignals(False)

        # 重置分页并手动触发一次带防抖的加载
        self.pagination.reset()
        self.current_offset = 0
        self.load_timer.start(200)


class AddStockDialog(QDialog):
    """增加分类库存对话框"""

    def __init__(self, category_id, category_name, parent=None):
        super().__init__(parent)
        self.category_id = category_id
        self.category_name = category_name
        self.db = DBManager()
        self.setWindowTitle(f"增加库存 - {category_name}")
        self.setModal(True)
        self.resize(400, 300)
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(20)
        layout.setContentsMargins(30, 30, 30, 30)

        # 标题
        title = QLabel(f"📦 为分类 [{self.category_name}] 增加库存")
        title.setStyleSheet(
            """
            QLabel {
                font-size: 18px;
                font-weight: 600;
                color: #1f2937;
                margin-bottom: 10px;
            }
            """
        )
        layout.addWidget(title)

        # 当前库存显示
        current_stock = self.db.get_category_stock(self.category_id)
        current_label = QLabel(f"当前库存: {current_stock}")
        current_label.setStyleSheet(
            """
            QLabel {
                font-size: 14px;
                color: #4b5563;
                padding: 10px;
                background-color: #f9fafb;
                border-radius: 8px;
                border: 1px solid #e5e7eb;
            }
            """
        )
        layout.addWidget(current_label)

        # 表单
        form_layout = QFormLayout()
        form_layout.setSpacing(15)

        # 数量输入
        self.quantity_input = QLineEdit()
        self.quantity_input.setPlaceholderText("请输入要增加的数量")
        self.quantity_input.setValidator(QIntValidator(1, 999999))
        self.quantity_input.setStyleSheet(
            """
            QLineEdit {
                padding: 12px;
                border: 2px solid #e5e7eb;
                border-radius: 8px;
                font-size: 14px;
            }
            QLineEdit:focus {
                border-color: #3b82f6;
                outline: none;
            }
            """
        )
        form_layout.addRow("增加数量:", self.quantity_input)

        # 备注输入
        self.remark_input = QTextEdit()
        self.remark_input.setMaximumHeight(80)
        self.remark_input.setPlaceholderText("请输入备注信息（可选）")
        self.remark_input.setStyleSheet(
            """
            QTextEdit {
                padding: 10px;
                border: 2px solid #e5e7eb;
                border-radius: 8px;
                font-size: 14px;
            }
            QTextEdit:focus {
                border-color: #3b82f6;
                outline: none;
            }
            """
        )
        form_layout.addRow("备注:", self.remark_input)

        layout.addLayout(form_layout)

        # 预设按钮
        preset_layout = QHBoxLayout()
        preset_label = QLabel("快速选择:")
        preset_label.setStyleSheet("font-weight: 500; color: #4b5563;")
        preset_layout.addWidget(preset_label)

        presets = [10, 50, 100, 500]
        for num in presets:
            btn = QPushButton(str(num))
            btn.setFixedSize(60, 30)
            btn.setStyleSheet(
                """
                QPushButton {
                    background-color: #f3f4f6;
                    color: #4b5563;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 12px;
                }
                QPushButton:hover {
                    background-color: #e5e7eb;
                }
                """
            )
            btn.clicked.connect(
                lambda checked, n=num: self.quantity_input.setText(str(n))
            )
            preset_layout.addWidget(btn)

        preset_layout.addStretch()
        layout.addLayout(preset_layout)

        # 按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        cancel_btn = QPushButton("取消")
        cancel_btn.setFixedSize(80, 35)
        cancel_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #f3f4f6;
                color: #4b5563;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
            }
            QPushButton:hover {
                background-color: #e5e7eb;
            }
            """
        )
        cancel_btn.clicked.connect(self.reject)
        button_layout.addWidget(cancel_btn)

        confirm_btn = QPushButton("确认增加")
        confirm_btn.setFixedSize(100, 35)
        confirm_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #10b981;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
            }
            QPushButton:hover {
                background-color: #34d399;
            }
            QPushButton:pressed {
                background-color: #059669;
            }
            """
        )
        confirm_btn.clicked.connect(self.accept_add_stock)
        button_layout.addWidget(confirm_btn)

        layout.addLayout(button_layout)

        # 默认聚焦到数量输入框
        self.quantity_input.setFocus()

    def accept_add_stock(self):
        """确认增加库存"""
        try:
            quantity_str = self.quantity_input.text().strip()
            if not quantity_str:
                QMessageBox.warning(self, "提示", "请输入要增加的数量。")
                return

            quantity = int(quantity_str)
            if quantity <= 0:
                QMessageBox.warning(self, "提示", "增加数量必须大于0。")
                return

            remark = self.remark_input.toPlainText().strip()

            # 调用数据库方法增加库存
            success, message = self.db.add_category_stock(
                self.category_id, quantity, "Admin", remark
            )

            if success:
                self.accept()  # 关闭对话框
            else:
                QMessageBox.critical(self, "错误", f"增加库存失败：{message}")

        except ValueError:
            QMessageBox.warning(self, "提示", "请输入有效的数字。")
        except Exception as e:
            QMessageBox.critical(self, "错误", f"操作失败：{str(e)}")

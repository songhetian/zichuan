import datetime
import pandas as pd
import sqlite3
import os
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QTableView,
    QLineEdit,
    QHeaderView,
    QDialog,
    QLabel,
    QComboBox,
    QFormLayout,
    QDateEdit,
    QFileDialog,
    QMessageBox,
    QAbstractItemView,
    QStyledItemDelegate,
    QStyleOptionButton,
    QStyle,
    QApplication,
    QTextEdit,
    QItemDelegate,
    QTreeView,
)
from PySide6.QtCore import (
    Qt,
    QDate,
    QAbstractTableModel,
    QModelIndex,
    QTimer,
    QRect,
    QSize,
)
from PySide6.QtGui import (
    QStandardItemModel,
    QStandardItem,
    QIcon,
    QColor,
    QPixmap,
    QFont,
    QPainter,
    QBrush,
)

from src.database.db_manager import DBManager
from src.utils.qr_generator import QRGenerator
from src.utils.pagination import PaginationWidget


# --- 核心改进：配件型号下拉代理 ---
class ComponentModelDelegate(QItemDelegate):
    def __init__(self, db, parent=None):
        super().__init__(parent)
        self.db = db

    def createEditor(self, parent, option, index):
        if index.column() == 1:  # 型号列
            type_name = index.model().data(index.model().index(index.row(), 0))
            _, models = self.db.get_all_component_models(type_name, limit=1000)
            cb = QComboBox(parent)
            cb.addItem("请选择型号...", None)
            for mid, _, mname, brand, stock in models:
                cb.addItem(f"{mname} ({brand}) - 库存:{stock}", mid)
            return cb
        if index.column() == 2:  # 数量列
            cb = QComboBox(parent)
            # 获取当前行选中的型号 ID
            mid = index.model().index(index.row(), 1).data(Qt.UserRole)
            stock = self.db.get_model_stock(mid) if mid else 0
            for i in range(1, stock + 1):
                cb.addItem(str(i), i)
            return cb
        return super().createEditor(parent, option, index)

    def setEditorData(self, editor, index):
        if isinstance(editor, QComboBox):
            cur_text = index.data(Qt.DisplayRole)
            idx = editor.findText(cur_text)
            if idx >= 0:
                editor.setCurrentIndex(idx)
        else:
            super().setEditorData(editor, index)

    def setModelData(self, editor, model, index):
        if isinstance(editor, QComboBox):
            model.setData(index, editor.currentText(), Qt.DisplayRole)
            model.setData(index, editor.currentData(), Qt.UserRole)
        else:
            super().setModelData(editor, model, index)


# --- 资产配件编辑代理 ---
class AssetComponentDelegate(QStyledItemDelegate):
    def __init__(self, db, get_cat_id_func, parent=None):
        super().__init__(parent)
        self.db = db
        self.get_cat_id = get_cat_id_func

    def createEditor(self, parent, option, index):
        if index.column() == 0:  # 配件类型
            cb = QComboBox(parent)
            # 核心改进：仅获取当前分类下的合规配件类型
            cat_id = self.get_cat_id()
            cb.addItems(self.db.get_component_types_by_category(cat_id))
            return cb
        elif index.column() == 1:  # 具体型号
            type_name = index.model().data(index.model().index(index.row(), 0))
            cat_id = self.get_cat_id()
            # 严格筛选：仅显示属于该分类的型号
            models = self.db.get_models_by_category_and_type(cat_id, type_name)

            cb = QComboBox(parent)
            cb.addItem("未选择型号", None)
            for item in models:
                if len(item) >= 5:
                    # get_all_component_models: (id, type, model, brand, stock, cat_name)
                    mid, _, mname, brand, stock, _ = item
                    cb.addItem(f"{mname} ({brand}) [库存: {stock}]", mid)
                else:
                    # get_models_by_category_and_type: (id, model, brand)
                    mid, mname, brand = item
                    stock = self.db.get_model_stock(mid)
                    cb.addItem(f"{mname} ({brand}) [库存: {stock}]", mid)
            return cb
        elif index.column() == 2:  # 数量
            cb = QComboBox(parent)
            # 获取当前行型号的库存，动态设置可选数量
            mid = index.model().index(index.row(), 1).data(Qt.UserRole)
            stock = self.db.get_model_stock(mid) if mid else 0
            # 允许选择 1 到 (当前库存 + 当前已分配数量) 的范围，或者至少 1-20
            max_val = max(20, stock + 10)
            cb.addItems([str(i) for i in range(1, max_val + 1)])

            # 自动弹出下拉列表
            from PySide6.QtCore import QTimer

            QTimer.singleShot(0, cb.showPopup)
            return cb
        return super().createEditor(parent, option, index)

    def setEditorData(self, editor, index):
        if isinstance(editor, QComboBox):
            if index.column() == 1:  # 型号
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

            if index.column() == 0:  # 修改类型
                # 检查是否已存在该类型 (不包括当前行)
                for r in range(model.rowCount()):
                    if r != index.row() and model.item(r, 0).text() == new_val:
                        QMessageBox.warning(
                            None,
                            "类型重复",
                            f"当前资产已配置了 [{new_val}]，请勿重复添加。\n您可以直接修改该项的数量。",
                        )
                        return  # 拦截，不更新

                model.setData(index, new_val, Qt.DisplayRole)
                if old_val != new_val:
                    model.setData(
                        model.index(index.row(), 1), "待选型号", Qt.DisplayRole
                    )
                    model.setData(model.index(index.row(), 1), None, Qt.UserRole)
                    model.setData(model.index(index.row(), 3), "-", Qt.DisplayRole)

            elif index.column() == 1:  # 修改型号
                mid = editor.currentData()
                model.setData(index, new_val, Qt.DisplayRole)
                model.setData(index, mid, Qt.UserRole)
                # 联动更新库存列 (第 3 列)
                stock = self.db.get_model_stock(mid) if mid else 0
                model.setData(model.index(index.row(), 3), str(stock), Qt.DisplayRole)
            elif index.column() == 2:  # 修改数量
                model.setData(index, new_val, Qt.DisplayRole)

            # 通知对话框：内容已修改
            dialog = self.parent().parent()  # QTreeView -> QDialog
            if hasattr(dialog, "set_dirty"):
                dialog.set_dirty()
        else:
            super().setModelData(editor, model, index)


class ComponentManageDialog(QDialog):
    def __init__(self, aid, name, cid, parent=None):
        super().__init__(parent)
        self.aid = aid
        self.cid = cid
        self.db = DBManager()
        self.is_dirty = False
        self.setWindowTitle(f"硬件配置管理 - {name}")
        self.resize(1000, 700)
        self.init_ui()
        self.load_components()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)

        # 操作栏
        toolbar = QHBoxLayout()
        add_btn = QPushButton("✚ 添加配件项")
        del_btn = QPushButton("— 移除选中配件")
        del_btn.setStyleSheet("color: #ff4d4f;")
        toolbar.addWidget(add_btn)
        toolbar.addWidget(del_btn)
        toolbar.addStretch()
        layout.addLayout(toolbar)
        add_btn.clicked.connect(self.add_item)
        del_btn.clicked.connect(self.del_item)

        # 列表视图
        self.view = QTreeView()
        self.view.setAlternatingRowColors(True)
        self.view.setSelectionBehavior(QAbstractItemView.SelectRows)
        # 单击即进入编辑：改为 AllEditTriggers 提升响应性
        self.view.setEditTriggers(QAbstractItemView.AllEditTriggers)
        self.view.clicked.connect(self.view.edit)
        self.view.setStyleSheet(
            """
            QTreeView::item { height: 45px; }
            QTreeView::item:selected {
                background-color: #e6f7ff;
                color: #1890ff;
            }
        """
        )
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(
            ["配件类型", "具体规格型号", "数量", "当前余量", "ID"]
        )
        # 监听数据变化
        self.model.itemChanged.connect(self.set_dirty)
        self.model.rowsInserted.connect(self.set_dirty)
        self.model.rowsRemoved.connect(self.set_dirty)

        self.view.setModel(self.model)
        self.view.header().setSectionResizeMode(QHeaderView.Stretch)
        self.view.setStyleSheet("QTreeView::item { height: 45px; }")
        self.view.setColumnHidden(4, True)
        self.view.setItemDelegate(
            AssetComponentDelegate(self.db, lambda: self.cid, self.view)
        )
        layout.addWidget(self.view)

        # 底部按钮
        self.save_btn = QPushButton("💾 保存配置变更")
        self.save_btn.setFixedHeight(45)
        self.save_btn.setStyleSheet(
            "background-color: #1890ff; color: white; font-weight: bold;"
        )
        self.save_btn.clicked.connect(self.save_changes)
        layout.addWidget(self.save_btn)

    def set_dirty(self):
        if not self.is_dirty:
            self.is_dirty = True
            self.save_btn.setStyleSheet(
                "background-color: #f5222d; color: white; font-weight: bold;"
            )
            self.save_btn.setText("⚠️ 配置已修改，请点击保存")

    def load_components(self):
        self.is_dirty = False
        self.save_btn.setStyleSheet(
            "background-color: #1890ff; color: white; font-weight: bold;"
        )
        self.save_btn.setText("💾 保存配置变更")
        self.model.blockSignals(True)
        self.model.removeRows(0, self.model.rowCount())

        # 获取现有配置
        components = self.db.get_asset_components_with_stock(self.aid)
        for db_id, _, name, spec, qty, mid, mname, stock in components:
            item_name = QStandardItem(name)
            item_spec = QStandardItem(mname if mname else spec)
            item_spec.setData(mid, Qt.UserRole)
            item_qty = QStandardItem(str(qty))
            item_stock = QStandardItem(str(stock) if mid else "-")
            item_stock.setEditable(False)
            self.model.appendRow(
                [item_name, item_spec, item_qty, item_stock, QStandardItem(str(db_id))]
            )
        self.model.blockSignals(False)

    def add_item(self):
        # 检查是否有尚未完成选择的空行
        for r in range(self.model.rowCount()):
            if self.model.item(r, 0).text() == "请选择类型":
                QMessageBox.warning(self, "提示", "请先完成当前空行的配件类型选择。")
                return

        new_name = QStandardItem("请选择类型")
        new_model = QStandardItem("待选型号")
        new_qty = QStandardItem("1")
        new_stock = QStandardItem("-")
        new_stock.setEditable(False)
        self.model.appendRow(
            [new_name, new_model, new_qty, new_stock, QStandardItem("-1")]
        )

    def del_item(self):
        indices = self.view.selectionModel().selectedRows()
        if indices:
            self.model.removeRow(indices[0].row())

    def save_changes(self):
        components = []
        for r in range(self.model.rowCount()):
            name_item = self.model.item(r, 0)
            spec_item = self.model.item(r, 1)
            qty_item = self.model.item(r, 2)
            if name_item.text() == "请选择类型":
                continue

            components.append(
                {
                    "name": name_item.text(),
                    "spec": spec_item.text(),
                    "qty": qty_item.text() or "1",
                    "model_id": spec_item.data(Qt.UserRole),
                }
            )

        success, msg = self.db.sync_asset_components(self.aid, components)
        if success:
            QMessageBox.information(self, "成功", "硬件配置已保存，相关库存已更新。")
            self.is_dirty = False
            self.accept()
        else:
            QMessageBox.critical(self, "保存失败", f"错误信息：{msg}")

    def refresh_data(self):
        # 保护逻辑：正在编辑时不刷新
        if not self.is_dirty:
            self.load_components()


class ButtonDelegate(QStyledItemDelegate):
    def __init__(self, parent=None):
        super().__init__(parent)

    def paint(self, painter, option, index):
        if index.column() == 8:
            # 绘制一个深橙色的管理按钮
            painter.save()
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)

            # 按钮区域
            rect = QRect(
                option.rect.left() + 10,
                option.rect.top() + 12,
                option.rect.width() - 20,
                option.rect.height() - 24,
            )

            color = QColor("#f57c00")  # 深橙色
            painter.setBrush(QBrush(color))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(rect, 4, 4)

            # 文字
            painter.setPen(QColor("white"))
            painter.setFont(QFont("Microsoft YaHei", 9, QFont.Bold))
            painter.drawText(rect, Qt.AlignCenter, "⚙️ 配置管理")

            painter.restore()
        else:
            super().paint(painter, option, index)


class AssetTableModel(QAbstractTableModel):
    def __init__(self, data=None, headers=None):
        super().__init__()
        self._data = data or []
        self._headers = headers or []

    def rowCount(self, p=QModelIndex()):
        return len(self._data)

    def columnCount(self, p=QModelIndex()):
        return len(self._headers)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        r = self._data[index.row()]
        c = index.column()
        if role == Qt.DisplayRole:
            return "" if c == 8 else (str(r[c]) if r[c] is not None else "-")
        if role == Qt.TextAlignmentRole:
            return Qt.AlignCenter
        if role == Qt.ForegroundRole and c == 6:
            st = str(r[6])
            if st == "在用":
                return QColor("#1890ff")
            if st == "闲置":
                return QColor("#52c41a")
            if st == "维修":
                return QColor("#fa8c16")
            if st == "报废":
                return QColor("#f5222d")
        if role == Qt.FontRole and c == 6:
            f = QFont()
            f.setBold(True)
            return f
        return None

    def headerData(self, s, o, role=Qt.DisplayRole):
        if role == Qt.DisplayRole and o == Qt.Horizontal:
            return self._headers[s]
        return None

    def update_data(self, d):
        self.beginResetModel()
        self._data = d
        self.endResetModel()


class AssetPage(QWidget):
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
        toolbar = QHBoxLayout()
        toolbar.setSpacing(10)
        self.s = QLineEdit()
        self.s.setPlaceholderText("🔍 全局搜索资产...")
        self.s.setFixedWidth(200)
        self.s.textChanged.connect(self.on_search_changed)
        self.d = QComboBox()
        self.d.addItem("全部部门", None)
        for did, n in self.db.get_departments():
            self.d.addItem(n, did)
        self.d.currentIndexChanged.connect(self.on_search_changed)

        self.c_cb = QComboBox()
        self.c_cb.addItem("全部分类", None)
        for cid, n in self.db.get_categories():
            self.c_cb.addItem(n, cid)
        self.c_cb.currentIndexChanged.connect(self.on_search_changed)

        self.st_cb = QComboBox()
        self.st_cb.addItems(["全部", "闲置", "在用", "维修", "报废"])
        self.st_cb.currentIndexChanged.connect(self.on_search_changed)

        btn_cfg = [
            ("📋 履历", self.open_history, ""),
            ("📥 导出", self.open_export, ""),
            ("✏️ 编辑", self.open_edit, ""),
            ("🛠️ 报废/维修", self.open_status, "#faad14"),
            ("🔄 领用", self.open_assign, "#1890ff"),
            ("♻️ 回收", self.open_recycle, "#722ed1"),  # 紫色
            ("🧨 销毁", self.open_destroy, "#cf1322"),  # 深红色
            ("🔳 标签", self.open_qr, ""),
            ("+ 新增", self.open_add, "#52c41a"),
        ]
        toolbar.addWidget(self.s)
        toolbar.addWidget(self.d)
        toolbar.addWidget(self.c_cb)
        toolbar.addWidget(self.st_cb)
        toolbar.addStretch()
        self.btns = {}
        for text, func, color in btn_cfg:
            btn = QPushButton(text)
            btn.clicked.connect(func)
            if color:
                btn.setStyleSheet(
                    f"background-color: {color}; color: white; font-weight: bold; padding: 8px 12px;"
                )
            else:
                btn.setStyleSheet("padding: 8px 10px;")
            toolbar.addWidget(btn)
            self.btns[text] = btn
        layout.addLayout(toolbar)

        self.table = QTableView()
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(60)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)

        self.headers = [
            "ID",
            "资产编号",
            "资产名称",
            "型号规格",
            "分类",
            "部门",
            "状态",
            "使用人",
            "硬件配置",
        ]
        self.model = AssetTableModel(headers=self.headers)
        self.table.setModel(self.model)
        self.table.selectionModel().selectionChanged.connect(self.update_btn_states)
        self.table.setItemDelegateForColumn(8, ButtonDelegate(self.table))
        self.table.clicked.connect(self.on_click)
        layout.addWidget(self.table)
        self.pagination = PaginationWidget(page_size=20)
        self.pagination.page_changed.connect(self.on_page_changed)
        layout.addWidget(self.pagination)

    def load_data(self):
        sel_aid = None
        idx = self.table.currentIndex()
        if idx.isValid() and idx.row() < len(self.model._data):
            sel_aid = self.model._data[idx.row()][0]
        total, rows = self.db.get_all_assets(
            self.s.text(),
            self.d.currentData(),
            self.c_cb.currentData(),
            self.st_cb.currentText(),
            limit=20,
            offset=self.offset,
        )
        # SQL 返回字段顺序:
        # 0:a.id, 1:a.asset_no, 2:a.name, 3:a.model, 4:c.name(分类), 5:d.name(部门), 6:a.status, 7:e.name(使用人), 8:a.spec, 9:a.purchase_date, 10:a.category_id

        # 我们的 headers (9列): ["ID", "资产编号", "资产名称", "型号规格", "分类", "部门", "状态", "使用人", "硬件配置"]
        processed = []
        for r in rows:
            item = [
                r[0],  # ID
                r[1],  # 资产编号
                r[2],  # 资产名称
                r[3],  # 型号规格 (a.model)
                r[4],  # 分类
                r[5],  # 部门
                r[6],  # 状态
                r[7],  # 使用人
                "",  # 硬件配置按钮占位 (Index 8)
            ]
            # 隐藏数据：Index 9 存放 category_id
            item.append(r[10])
            processed.append(item)

        self.model.update_data(processed)
        self.pagination.update_stats(total)
        if sel_aid:
            for r in range(len(self.model._data)):
                if self.model._data[r][0] == sel_aid:
                    self.table.selectRow(r)
                    break

    def on_click(self, idx):
        if idx.column() == 8:
            r = self.model._data[idx.row()]
            status = r[6]
            if status in ["报废", "维修"]:
                QMessageBox.warning(
                    self, "禁止修改", f"当前资产处于[{status}]状态，无法修改硬件配置。"
                )
                return
            # category_id 现在固定在 index 9
            ComponentManageDialog(r[0], r[2], r[9], self).exec()
            self.load_data()

    def update_btn_states(self):
        idx = self.table.currentIndex()
        if not idx.isValid():
            return
        status = self.model._data[idx.row()][6]
        # 仅报废资产可以回收和彻底销毁
        is_scrapped = status == "报废"
        if "♻️ 回收" in self.btns:
            self.btns["♻️ 回收"].setVisible(is_scrapped)
        if "🧨 销毁" in self.btns:
            self.btns["🧨 销毁"].setVisible(is_scrapped)

    def open_recycle(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            r = self.model._data[idx.row()]
            RecycleAssetDialog(r[0], r[2], self).exec()
            self.load_data()

    def open_destroy(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            r = self.model._data[idx.row()]
            rep = QMessageBox.critical(
                self,
                "警告：彻底销毁",
                f"确定要彻底销毁资产 [{r[2]}] 及其档案吗？\n该操作不可撤销且剩余配件不会退库！",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            if rep == QMessageBox.Yes:
                if self.db.destroy_asset_completely(r[0], "Admin"):
                    self.load_data()

    def open_assign(self):
        idx = self.table.currentIndex()
        if not idx.isValid():
            QMessageBox.warning(self, "提示", "请先在列表中选择一个闲置资产。")
            return
        r = self.model._data[idx.row()]
        if r[6] != "闲置":
            QMessageBox.warning(self, "禁止分配", f"当前资产状态为[{r[6]}]，无法分配。")
            return
        if DirectAssignDialog(r[0], r[2], r[1], self).exec():
            self.load_data()

    def on_search_changed(self):
        self.offset = 0
        self.pagination.reset()
        self.load_data()

    def on_page_changed(self, offset):
        self.offset = offset
        self.load_data()

    def open_add(self):
        if AddAssetDialog(self).exec():
            self.load_data()

    def open_edit(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            aid = self.model._data[idx.row()][0]
            conn = self.db.get_connection()
            c = conn.cursor()
            c.execute("SELECT * FROM assets WHERE id=?", (aid,))
            data = c.fetchone()
            conn.close()
            if EditAssetDialog(data, self).exec():
                self.load_data()

    def open_status(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            r = self.model._data[idx.row()]
            if StatusChangeDialog(r[0], r[2], r[6], self).exec():
                self.load_data()

    def open_history(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            AssetHistoryDialog(
                self.model._data[idx.row()][0], self.model._data[idx.row()][2], self
            ).exec()

    def open_qr(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            aid = self.model._data[idx.row()][0]
            conn = self.db.get_connection()
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT a.asset_no, a.name, a.status, d.name as dept FROM assets a LEFT JOIN departments d ON a.dept_id=d.id WHERE a.id=?",
                (aid,),
            )
            data = dict(c.fetchone())

            # 获取完整配置
            c.execute(
                "SELECT comp_name, comp_spec FROM asset_components WHERE asset_id=?",
                (aid,),
            )
            full_spec = " / ".join(
                [f"{x[0]}: {x[1]}" for x in c.fetchall() if x[1] and str(x[1]).strip()]
            )
            data["full_spec"] = full_spec

            conn.close()
            AssetQRDialog(data, self).exec()

    def open_export(self):
        p, _ = QFileDialog.getSaveFileName(
            self, "导出档案", "资产档案.xlsx", "Excel Files (*.xlsx)"
        )
        if p:
            self.db.get_assets_for_export().to_excel(p, index=False)

    def refresh_data(self):
        self.load_data()


class DirectAssignDialog(QDialog):
    def __init__(self, aid, name, no, parent=None):
        super().__init__(parent)
        self.aid = aid
        self.db = DBManager()
        self.setWindowTitle(f"分配资产 - {name}")
        self.resize(500, 400)
        self.init_ui()

    def init_ui(self):
        l = QVBoxLayout(self)
        l.setContentsMargins(40, 40, 40, 40)
        f = QFormLayout()
        f.setSpacing(30)
        self.e_cb = QComboBox()
        [
            self.e_cb.addItem(f"{r[2]} ({r[3]})", r[0])
            for r in self.db.get_all_employees(status="在职", limit=None)
        ]
        self.rem = QTextEdit()
        self.rem.setFixedHeight(100)
        f.addRow("领用人员:", self.e_cb)
        f.addRow("备注说明:", self.rem)
        l.addLayout(f)
        btn = QPushButton("确认分配")
        btn.setFixedHeight(50)
        btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold;")
        btn.clicked.connect(self.save)
        l.addWidget(btn)

    def save(self):
        success, msg = self.db.checkout_asset(
            self.aid, self.e_cb.currentData(), "Admin", self.rem.toPlainText()
        )
        if success:
            QMessageBox.information(
                self, "分配成功", f"资产已成功分配给 {self.e_cb.currentText()}\n{msg}"
            )
            self.accept()
        else:
            QMessageBox.warning(self, "分配失败", msg)


class EditAssetDialog(QDialog):
    def __init__(self, data, parent=None):
        super().__init__(parent)
        self.aid = data[0]
        self.setWindowTitle("编辑资产详细档案")
        self.resize(800, 600)
        self.db = DBManager()
        self.init_ui(data)

    def init_ui(self, data):
        l = QVBoxLayout(self)
        f = QFormLayout()
        f.setSpacing(30)
        f.setContentsMargins(50, 50, 50, 50)
        self.n = QLineEdit(str(data[2]))
        self.m = QLineEdit(str(data[3]))
        self.r = QTextEdit(str(data[14] or ""))
        f.addRow("设备名称*:", self.n)
        f.addRow("型号规格:", self.m)
        f.addRow("详细备注信息:", self.r)
        l.addLayout(f)
        b = QPushButton("💾 确认保存修改")
        b.setFixedHeight(55)
        b.setStyleSheet(
            "background-color: #1890ff; color: white; font-weight: bold; font-size: 16px;"
        )
        b.clicked.connect(self.save)
        l.addWidget(b)

    def save(self):
        if self.db.update_asset(
            self.aid,
            {
                "name": self.n.text(),
                "model": self.m.text(),
                "remarks": self.r.toPlainText(),
            },
            "Admin",
        ):
            self.accept()


class AddAssetDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.db = DBManager()
        self.setWindowTitle("资产入库登记")
        self.resize(700, 600)
        self.init_ui()

    def init_ui(self):
        l = QVBoxLayout(self)
        f = QFormLayout()
        f.setSpacing(25)
        f.setContentsMargins(40, 40, 40, 40)
        self.no_lbl = QLabel("系统自动生成")
        self.no_lbl.setStyleSheet("color: #999; font-weight: bold;")
        self.name = QLineEdit()
        self.cat = QComboBox()
        for cid, n in self.db.get_categories():
            self.cat.addItem(n, cid)
        self.dept = QComboBox()
        [self.dept.addItem(n, i) for i, n in self.db.get_departments()]
        f.addRow("资产编号:", self.no_lbl)
        f.addRow("设备名称*:", self.name)
        f.addRow("所属分类:", self.cat)
        f.addRow("归属部门:", self.dept)
        l.addLayout(f)
        b = QPushButton("✅ 确认入库并生成档案")
        b.setFixedHeight(50)
        b.setStyleSheet("background-color: #52c41a; color: white; font-weight: bold;")
        b.clicked.connect(self.save)
        l.addWidget(b)

    def save(self):
        if not self.name.text():
            QMessageBox.warning(self, "提示", "设备名称不能为空。")
            return

        asset_data = {
            "name": self.name.text(),
            "category_id": self.cat.currentData(),
            "dept_id": self.dept.currentData(),
            "status": "闲置",
        }

        # 使用带库存检查的新方法
        new_asset_id, message = self.db.add_asset_with_category_stock_check(
            asset_data, "Admin"
        )

        if new_asset_id:
            # 成功创建资产后，填充配件模板
            category_id = self.cat.currentData()
            self.db.populate_asset_components_from_category(new_asset_id, category_id)
            QMessageBox.information(self, "成功", f"资产创建成功！{message}")
            self.accept()
        else:
            QMessageBox.critical(self, "错误", f"添加资产失败：{message}")


class AssetHistoryDialog(QDialog):
    def __init__(self, aid, name, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"流转审计履历 - {name}")
        self.resize(800, 500)
        self.db = DBManager()
        l = QVBoxLayout(self)
        t = QTableView()
        t.verticalHeader().setVisible(False)
        t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        m = QStandardItemModel()
        m.setHorizontalHeaderLabels(["时间", "动作", "操作员", "相关人"])
        t.setModel(m)
        l.addWidget(t)
        for r in self.db.get_asset_resume(aid):
            m.appendRow([QStandardItem(str(x)) for x in r])


class StatusChangeDialog(QDialog):
    def __init__(self, aid, name, cur_st, parent=None):
        super().__init__(parent)
        self.aid = aid
        self.db = DBManager()
        self.setWindowTitle("状态手动变更")
        self.setFixedSize(450, 380)
        self.init_ui(cur_st)

    def init_ui(self, cur_st):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(20)

        header = QLabel("🔄 资产状态手动调整")
        header.setStyleSheet("font-size: 18px; font-weight: bold; color: #1890ff;")
        layout.addWidget(header)

        form = QFormLayout()
        form.setSpacing(15)
        form.setLabelAlignment(Qt.AlignRight)

        self.cb = QComboBox()
        self.cb.addItems(["闲置", "维修", "报废"])
        self.cb.setMinimumHeight(35)
        # 排除当前状态
        self.cb.setCurrentText(cur_st if cur_st in ["闲置", "维修", "报废"] else "闲置")

        self.rem = QTextEdit()
        self.rem.setPlaceholderText("请简述变更原因（如：设备老化、由于XX原因报废等）")
        self.rem.setFixedHeight(100)

        form.addRow("目标新状态:", self.cb)
        form.addRow("变更原因:", self.rem)
        layout.addLayout(form)

        btn_box = QHBoxLayout()
        save_btn = QPushButton("确认提交变更")
        save_btn.setFixedHeight(45)
        save_btn.setStyleSheet(
            "background-color: #1890ff; color: white; font-weight: bold; border-radius: 4px;"
        )
        save_btn.clicked.connect(self.save)

        cancel_btn = QPushButton("取消")
        cancel_btn.setFixedHeight(45)
        cancel_btn.clicked.connect(self.reject)

        btn_box.addWidget(cancel_btn, 1)
        btn_box.addWidget(save_btn, 2)
        layout.addLayout(btn_box)

    def save(self):
        if not self.rem.toPlainText().strip():
            QMessageBox.warning(self, "提示", "请填写变更原因。")
            return
        if self.db.change_asset_status(
            self.aid, self.cb.currentText(), "Admin", self.rem.toPlainText()
        ):
            self.accept()


class RecycleAssetDialog(QDialog):
    def __init__(self, aid, name, parent=None):
        super().__init__(parent)
        self.aid = aid
        self.db = DBManager()
        self.setWindowTitle(f"配件回收 - {name}")
        self.resize(650, 500)
        self.init_ui()
        self.load_data()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)

        info = QLabel("勾选需要回收进库存的配件（如有损坏请勿勾选）：")
        info.setStyleSheet("color: #666; font-weight: bold;")
        layout.addWidget(info)

        self.view = QTreeView()
        self.view.setAlternatingRowColors(True)
        self.view.header().setSectionResizeMode(QHeaderView.Stretch)
        self.model = QStandardItemModel()
        self.model.setHorizontalHeaderLabels(["回收", "配件项", "型号规格", "当前数量"])
        self.view.setModel(self.model)
        layout.addWidget(self.view)

        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(15)

        self.recycle_btn = QPushButton("♻️ 仅回收选中配件")
        self.recycle_btn.setFixedHeight(45)
        self.recycle_btn.setStyleSheet(
            "background-color: #1890ff; color: white; font-weight: bold;"
        )
        self.recycle_btn.clicked.connect(lambda: self.save_action(False))

        self.rd_btn = QPushButton("♻️+🧨 回收并销毁资产")
        self.rd_btn.setFixedHeight(45)
        self.rd_btn.setStyleSheet(
            "background-color: #f5222d; color: white; font-weight: bold;"
        )
        self.rd_btn.clicked.connect(lambda: self.save_action(True))

        btn_layout.addWidget(self.recycle_btn)
        btn_layout.addWidget(self.rd_btn)
        layout.addLayout(btn_layout)

    def load_data(self):
        # 获取该资产的所有配件（带库存关联信息）
        comps = self.db.get_asset_components_with_stock(self.aid)
        for acid, _, name, spec, qty, mid, mname, _ in comps:
            if not mid:
                continue  # 只有绑定了库存型号的配件才能回库

            c_item = QStandardItem()
            c_item.setCheckable(True)
            c_item.setCheckState(Qt.Checked)
            c_item.setData(acid, Qt.UserRole)

            self.model.appendRow(
                [
                    c_item,
                    QStandardItem(name),
                    QStandardItem(mname or spec),
                    QStandardItem(str(qty)),
                ]
            )

    def save_action(self, destroy_after):
        selected_ids = []
        for r in range(self.model.rowCount()):
            item = self.model.item(r, 0)
            if item.checkState() == Qt.Checked:
                selected_ids.append(item.data(Qt.UserRole))

        if not selected_ids and not destroy_after:
            QMessageBox.warning(self, "提示", "未选择任何要回收的配件。")
            return

        if selected_ids:
            if not self.db.recycle_asset_components(self.aid, selected_ids, "Admin"):
                QMessageBox.critical(self, "错误", "配件回收失败，请检查数据库。")
                return

        if destroy_after:
            msg = (
                "配件已回收（如有勾选）且资产已彻底销毁。"
                if selected_ids
                else "资产已彻底销毁。"
            )
            if self.db.destroy_asset_completely(self.aid, "Admin"):
                QMessageBox.information(self, "成功", msg)
            else:
                QMessageBox.critical(self, "错误", "资产销毁失败。")
        else:
            QMessageBox.information(self, "成功", "选中配件已成功回收进库存。")

        self.accept()


class AssetQRDialog(QDialog):
    def __init__(self, d, parent=None):
        super().__init__(parent)
        self.setWindowTitle("资产标签预览")
        self.resize(650, 400)
        label_img = QRGenerator.generate_asset_label(d)
        l = QVBoxLayout(self)
        l.setAlignment(Qt.AlignCenter)
        pix = QPixmap()
        pix.loadFromData(QRGenerator.save_to_bytes(label_img))
        lbl = QLabel()
        lbl.setPixmap(pix)
        l.addWidget(lbl)

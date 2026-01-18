from PySide6.QtWidgets import QComboBox, QCompleter
from PySide6.QtCore import Qt, QStringListModel
from pypinyin import lazy_pinyin

class PinyinComboBox(QComboBox):
    """支持拼音首字母和中文联想的下拉框"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setEditable(True)
        self.setInsertPolicy(QComboBox.NoInsert)
        
        # 显式使用 QStringListModel
        self.model_obj = QStringListModel()
        self.completer = QCompleter(self.model_obj, self)
        self.completer.setCompletionMode(QCompleter.PopupCompletion)
        self.completer.setFilterMode(Qt.MatchContains)
        self.setCompleter(self.completer)
        
        # 存储原始数据以供匹配
        self.raw_items = []

    def add_pinyin_items(self, items_with_ids):
        """
        items_with_ids: list of (id, text)
        """
        self.clear()
        self.raw_items = items_with_ids
        
        display_items = []
        for _, text in items_with_ids:
            # 记录原始文本
            display_items.append(text)
            
        self.addItems(display_items)
        # 更新 Completer 的数据源
        self.model_obj.setStringList(display_items)

    def currentData(self):
        index = self.currentIndex()
        if index >= 0 and index < len(self.raw_items):
            return self.raw_items[index][0]
        return None
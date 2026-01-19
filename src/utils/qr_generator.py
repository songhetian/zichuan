import qrcode
from PIL import Image, ImageDraw, ImageFont
import io

class QRGenerator:
    _fonts_cache = {}

    @classmethod
    def _get_fonts(cls):
        if not cls._fonts_cache:
            try:
                cls._fonts_cache['header'] = ImageFont.truetype("msyh.ttc", 32)
                cls._fonts_cache['label'] = ImageFont.truetype("msyh.ttc", 22)
                cls._fonts_cache['value'] = ImageFont.truetype("msyh.ttc", 22)
                cls._fonts_cache['small'] = ImageFont.truetype("msyh.ttc", 16)
            except:
                default = ImageFont.load_default()
                cls._fonts_cache = {'header': default, 'label': default, 'value': default, 'small': default}
        return cls._fonts_cache

    @staticmethod
    def generate_asset_label(asset_info):
        """
        生成专业级详细资产标签 (800x400)
        """
        # 1. 准备二维码 (保持核心数据)
        qr_text = f"资产号: {asset_info.get('asset_no')}\n设备: {asset_info.get('name')}\n部门: {asset_info.get('dept') or '未分配'}"
        qr = qrcode.QRCode(version=None, box_size=10, border=1)
        qr.add_data(qr_text)
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white").convert('RGB')

        # 2. 画布设计
        width, height = 800, 400
        canvas = Image.new('RGB', (width, height), 'white')
        draw = ImageDraw.Draw(canvas)
        
        # 绘制蓝色页眉
        draw.rectangle([0, 0, width, 70], fill="#1890ff")
        
        fonts = QRGenerator._get_fonts()

        draw.text((30, 15), "🏢 企业固定资产档案标签", fill="white", font=fonts['header'])

        # 放置二维码
        qr_img = qr_img.resize((280, 280))
        canvas.paste(qr_img, (20, 90))

        # 绘制右侧信息区
        start_x = 330
        curr_y = 100
        row_height = 50

        info_list = [
            ("资产编号", asset_info.get('asset_no')),
            ("设备名称", asset_info.get('name')),
            ("所属部门", asset_info.get('dept') or "未指定"),
            ("当前状态", asset_info.get('status') or "在库"),
            ("详细配置", asset_info.get('full_spec') or "标准配置")
        ]

        for label, val in info_list:
            draw.text((start_x, curr_y), f"{label}:", fill="#8c8c8c", font=fonts['label'])
            
            clean_val = str(val)
            val_color = "#1890ff" if label == "当前状态" else "black"
            
            if label == "详细配置":
                # 详细配置支持更多行显示，使用更小字体
                spec_font = fonts['small']
                max_chars = 28 # 每行约28个字符
                # 简单的多行切分逻辑
                lines = [clean_val[i:i+max_chars] for i in range(0, len(clean_val), max_chars)]
                for i, line in enumerate(lines[:3]): # 最多显示3行配置
                    draw.text((start_x + 110, curr_y + i*20), line, fill=val_color, font=spec_font)
            else:
                if len(clean_val) > 18:
                    clean_val = clean_val[:16] + "..."
                draw.text((start_x + 110, curr_y), clean_val, fill=val_color, font=fonts['value'])
            
            # 画分割 line
            draw.line([(start_x, curr_y + 35), (770, curr_y + 35)], fill="#f0f0f0", width=1)
            curr_y += row_height

        draw.text((start_x, 360), "提示: 使用移动终端扫码可查看完整履历", fill="#bfbfbf", font=fonts['small'])

        # 边框装饰
        draw.rectangle([0, 0, width-1, height-1], outline="#e1e4e8", width=2)

        return canvas

    @staticmethod
    def save_to_bytes(pil_img):
        img_byte_arr = io.BytesIO()
        pil_img.save(img_byte_arr, format='PNG')
        return img_byte_arr.getvalue()
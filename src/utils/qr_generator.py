import qrcode
from PIL import Image, ImageDraw, ImageFont
import io

class QRGenerator:
    @staticmethod
    def generate_asset_label(asset_info):
        """
        生成可视化资产标签 (进一步压缩 QR 内容以适配微信)
        """
        # 1. 极其精简的内容 (字数越少，微信越容易直接展示)
        # 移除所有多余描述词，仅保留核心数据
        qr_text = (
            f"ID:{asset_info.get('asset_no')}\n"
            f"设备:{asset_info.get('name')}\n"
            f"配置:{asset_info.get('spec') or '标准'}"
        )

        qr = qrcode.QRCode(version=None, box_size=10, border=1)
        # 必须使用 utf-8
        qr.add_data(qr_text)
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white").convert('RGB')

        # 2. 画布设计 (优化文字排版，确保不扫码也能看清)
        canvas = Image.new('RGB', (600, 250), 'white')
        draw = ImageDraw.Draw(canvas)
        
        qr_img = qr_img.resize((230, 230))
        canvas.paste(qr_img, (10, 10))

        try:
            # 尝试加载微软雅黑
            font_title = ImageFont.truetype("msyh.ttc", 22)
            font_content = ImageFont.truetype("msyh.ttc", 18)
        except:
            font_title = ImageFont.load_default()
            font_content = ImageFont.load_default()

        # 右侧视觉引导
        draw.text((270, 25), "公司固定资产标签", fill="#1890ff", font=font_title)
        draw.line([(270, 60), (570, 60)], fill="#1890ff", width=2)
        
        # 核心信息展示
        draw.text((270, 80), f"资产编号: {asset_info.get('asset_no')}", fill="black", font=font_content)
        draw.text((270, 120), f"设备名称: {asset_info.get('name')[:12]}", fill="black", font=font_content)
        
        spec = asset_info.get('spec') or '标准配置'
        if len(spec) > 25: spec = spec[:22] + "..."
        draw.text((270, 160), f"硬件详情: {spec}", fill="black", font=font_content)
        
        draw.text((270, 210), "提示: 请使用手机系统相机扫码", fill="#999", font=ImageFont.load_default())

        return canvas

    @staticmethod
    def save_to_bytes(pil_img):
        img_byte_arr = io.BytesIO()
        pil_img.save(img_byte_arr, format='PNG')
        return img_byte_arr.getvalue()
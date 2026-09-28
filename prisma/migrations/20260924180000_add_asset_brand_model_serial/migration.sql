-- 设备自身品牌/型号/序列号：外设（显示器、打印机等）升为设备层后需要独立登记这三项
-- 三列均可空、不加唯一约束（序列号允许重复登记，历史数据不回填）
ALTER TABLE `Asset`
  ADD COLUMN `brand` VARCHAR(191) NULL,
  ADD COLUMN `model` VARCHAR(191) NULL,
  ADD COLUMN `serialNo` VARCHAR(191) NULL;

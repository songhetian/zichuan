-- 模板层品牌/型号：同类设备的品牌型号应挂在模板上，建档时带出到设备，避免每台重复手填
-- 两列均可空、不影响存量模板（存量模板品牌型号留空，设备仍可单独补录）
ALTER TABLE `DeviceTemplate`
  ADD COLUMN `brand` VARCHAR(191) NULL,
  ADD COLUMN `model` VARCHAR(191) NULL;

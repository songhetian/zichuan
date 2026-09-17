-- 1) 模板 BOM 移除全部显示器(cat4)行：显示器走资产详情「添加配件」逐台挂
DELETE tc FROM TemplateComponent tc
JOIN ComponentModel cm ON cm.id = tc.modelId
WHERE cm.categoryId = 4;

-- 2) 为 BOM 缺内存(cat2)/硬盘(cat3) 的模板，从资产实际配置回填「最常见」型号
-- 2a. 候选：模板下资产出现过的 (templateId, categoryId, modelId, 资产数)
CREATE TEMPORARY TABLE bom_candidate AS
SELECT a.templateId AS templateId, cm.categoryId AS categoryId, ac.modelId AS modelId,
       COUNT(DISTINCT a.id) AS assetCnt
FROM Asset a
JOIN AssetComponent ac ON ac.assetId = a.id
JOIN ComponentModel cm ON cm.id = ac.modelId
WHERE cm.categoryId IN (2, 3)
GROUP BY a.templateId, cm.categoryId, ac.modelId;

-- 2b. 每组取资产数最多的一个型号（并列取 modelId 小者）
CREATE TEMPORARY TABLE bom_pick AS
SELECT templateId, categoryId, modelId FROM (
  SELECT bc.*,
         ROW_NUMBER() OVER (PARTITION BY templateId, categoryId ORDER BY assetCnt DESC, modelId ASC) AS rn
  FROM bom_candidate bc
) x WHERE rn = 1;

-- 2c. 该型号在该模板下最常见的单台数量（并列取小数量）
CREATE TEMPORARY TABLE bom_qty AS
SELECT templateId, modelId, quantity FROM (
  SELECT p.templateId, ac.modelId, ac.quantity, COUNT(DISTINCT a.id) AS cnt,
         ROW_NUMBER() OVER (PARTITION BY p.templateId, ac.modelId ORDER BY COUNT(DISTINCT a.id) DESC, ac.quantity ASC) AS rn
  FROM Asset a
  JOIN AssetComponent ac ON ac.assetId = a.id
  JOIN bom_pick p ON p.templateId = a.templateId AND p.modelId = ac.modelId
  GROUP BY p.templateId, ac.modelId, ac.quantity
) y WHERE rn = 1;

-- 2d. 只回填 BOM 里缺该分类的模板，避免重复
INSERT INTO TemplateComponent (templateId, modelId, quantity)
SELECT p.templateId, p.modelId, q.quantity
FROM bom_pick p
JOIN bom_qty q ON q.templateId = p.templateId AND q.modelId = p.modelId
WHERE NOT EXISTS (
  SELECT 1 FROM TemplateComponent tc
  JOIN ComponentModel cm ON cm.id = tc.modelId
  WHERE tc.templateId = p.templateId AND cm.categoryId = p.categoryId
);

DROP TEMPORARY TABLE bom_candidate;
DROP TEMPORARY TABLE bom_pick;
DROP TEMPORARY TABLE bom_qty;

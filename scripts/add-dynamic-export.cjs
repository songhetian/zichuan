const fs = require('fs');
const path = require('path');

const files = [
  'src/app/(main)/assets/[id]/page.tsx',
  'src/app/(main)/settings/labels/page.tsx',
  'src/app/(main)/dashboard/page.tsx',
  'src/app/(main)/assets/page.tsx',
  'src/app/(main)/templates/page.tsx',
  'src/app/(main)/stocktake/page.tsx',
  'src/app/(main)/stocktake/[id]/page.tsx',
  'src/app/(main)/settings/departments/page.tsx',
  'src/app/(main)/settings/component-categories/page.tsx',
  'src/app/(main)/settings/asset-categories/page.tsx',
  'src/app/(main)/settings/account/page.tsx',
  'src/app/(main)/logs/page.tsx',
  'src/app/(main)/employees/page.tsx',
  'src/app/(main)/components/stock/page.tsx',
  'src/app/(main)/components/models/page.tsx'
];

files.forEach(f => {
  const fullPath = path.join('e:/System/zichuan', f);
  let content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes('export const dynamic')) {
    content = "export const dynamic = 'force-dynamic';\n\n" + content;
    fs.writeFileSync(fullPath, content);
    console.log('Updated:', f);
  } else {
    console.log('Skipped:', f);
  }
});

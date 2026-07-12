const fs = require("fs");
const path = require("path");
const postcss = require("postcss");

const cssPath = path.resolve(__dirname, "..", "index.css");
const source = fs.readFileSync(cssPath, "utf8");
const root = postcss.parse(source);
const unused = /\.(workspace-hero(?:-[a-z-]+)?|workspace-metrics|badge-row|ground-panels|vehicle-detail|vehicle-compare)\b|#(?:line-chart-svg|legend-svg|selected-table(?:-div)?)(?![a-z-])/;
let removed = 0;

root.walkRules(rule => {
  const selectors = rule.selectors;
  if (!selectors) return;
  const kept = selectors.filter(selector => !unused.test(selector));
  removed += selectors.length - kept.length;
  if (kept.length === 0) rule.remove();
  else rule.selectors = kept;
});

fs.writeFileSync(cssPath, root.toString());
console.log(`Removed ${removed} unused CSS selectors.`);

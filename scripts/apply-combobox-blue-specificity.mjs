import fs from "node:fs";
const path = "app/globals.css";
let css = fs.readFileSync(path, "utf8");
const marker = "/* Final combobox option interaction color authority. */";
if (!css.includes(marker)) {
  css += `\n\n${marker}\n.combobox-results [role=\"option\"].selected,\n.combobox-results [role=\"option\"][aria-selected=\"true\"],\n.combobox-results [role=\"option\"]:hover,\n.combobox-results [role=\"option\"].highlighted,\n.combobox-results [role=\"option\"]:focus-visible {\n  color: #fff !important;\n  background: #1967d2 !important;\n}\n`;
  fs.writeFileSync(path, css);
}

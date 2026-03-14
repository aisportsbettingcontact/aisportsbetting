import { parseAnAllMarketsHtml } from "./server/anHtmlParser.ts";
import { readFileSync } from "fs";

const html = readFileSync("/home/ubuntu/upload/pasted_content_26.txt", "utf8");
const result = parseAnAllMarketsHtml(html);

console.log("Games:", result.games.length);
console.log("DK col:", result.dkColumnIndex);
console.log("Warnings:", result.warnings);

result.games.forEach((g, i) => {
  console.log(`\nGame ${i + 1}: ${g.awayName} @ ${g.homeName} [AN:${g.anGameId}]`);
  console.log(
    `  SPREAD open: ${g.openAwaySpread?.line}(${g.openAwaySpread?.juice}) / ${g.openHomeSpread?.line}(${g.openHomeSpread?.juice})`
  );
  console.log(
    `  SPREAD DK:   ${g.dkAwaySpread?.line}(${g.dkAwaySpread?.juice}) / ${g.dkHomeSpread?.line}(${g.dkHomeSpread?.juice})`
  );
  console.log(
    `  TOTAL  open: ${g.openOver?.line}(${g.openOver?.juice}) / ${g.openUnder?.line}(${g.openUnder?.juice})`
  );
  console.log(
    `  TOTAL  DK:   ${g.dkOver?.line}(${g.dkOver?.juice}) / ${g.dkUnder?.line}(${g.dkUnder?.juice})`
  );
  console.log(`  ML     open: ${g.openAwayML?.line} / ${g.openHomeML?.line}`);
  console.log(`  ML     DK:   ${g.dkAwayML?.line} / ${g.dkHomeML?.line}`);
});

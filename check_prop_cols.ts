import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  
  console.log("=== mlb_strikeout_props columns ===");
  const [kCols] = await conn.execute<mysql2.RowDataPacket[]>("SHOW COLUMNS FROM mlb_strikeout_props");
  (kCols as any[]).forEach((c: any) => console.log(`  ${c.Field} — ${c.Type}`));
  
  console.log("\n=== mlb_hr_props columns ===");
  const [hrCols] = await conn.execute<mysql2.RowDataPacket[]>("SHOW COLUMNS FROM mlb_hr_props");
  (hrCols as any[]).forEach((c: any) => console.log(`  ${c.Field} — ${c.Type}`));
  
  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

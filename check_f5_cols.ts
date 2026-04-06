import * as dotenv from "dotenv";
dotenv.config();
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  const [cols] = await conn.execute<mysql2.RowDataPacket[]>("SHOW COLUMNS FROM games");
  const f5Cols = (cols as any[]).filter((c: any) => c.Field.toLowerCase().includes("f5") || c.Field.toLowerCase().includes("nrfi") || c.Field.toLowerCase().includes("actual"));
  f5Cols.forEach((c: any) => console.log(c.Field, "—", c.Type));
  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

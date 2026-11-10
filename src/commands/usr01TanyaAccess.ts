/**
 * T-USR-01: Vadim §3 — regular user Tanya: Sales, Quality, Contacts, Autotransport.
 *
 *   npm run usr01-tanya
 *   npm run usr01-tanya -- --apply
 */
import { authenticate, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");

const TANYA_LOGIN = "Tmochalovaa2704@ukr.net";

/** Non-admin app groups (prod names). */
const REQUIRED_FULL_NAMES = [
  "Role / User",
  "Якість / Користувач",
  "Продажі / Користувач: Усі документи",
  "Контакт / Створення",
  "Автотранспорт / Керівник: Керуйте всім автотранспортом",
] as const;

const FORBIDDEN_SUBSTR = ["Role / Administrator", "/ Адміністратор"];

async function resolveGroupIds(): Promise<number[]> {
  const ids: number[] = [];
  for (const full of REQUIRED_FULL_NAMES) {
    const [row] = await searchRead<{ id: number; full_name: string }>(
      "res.groups",
      [["full_name", "=", full]],
      ["id", "full_name"],
      1,
    );
    if (!row) throw new Error(`group not found: ${full}`);
    ids.push(row.id);
  }
  return ids;
}

async function main() {
  await authenticate();
  const required = await resolveGroupIds();

  const [user] = await searchRead<{ id: number; name: string; group_ids: number[] }>(
    "res.users",
    [["login", "=", TANYA_LOGIN]],
    ["id", "name", "group_ids"],
    1,
  );
  if (!user) throw new Error(`user login ${TANYA_LOGIN} not found`);

  const current = await searchRead<{ id: number; full_name: string }>(
    "res.groups",
    [["id", "in", user.group_ids]],
    ["id", "full_name"],
    200,
  );

  for (const g of current) {
    if (FORBIDDEN_SUBSTR.some((s) => g.full_name.includes(s))) {
      throw new Error(`user ${user.name} has admin group "${g.full_name}" — fix manually first`);
    }
  }

  const missing = required.filter((id) => !user.group_ids.includes(id));
  const names = await searchRead<{ id: number; full_name: string }>(
    "res.groups",
    [["id", "in", required]],
    ["id", "full_name"],
    20,
  );
  console.log(`user ${user.id} ${user.name}`);
  for (const n of names) console.log(`  need  ${n.full_name}`);

  if (!missing.length) {
    console.log("ok      all T-USR-01 groups present");
    return;
  }

  for (const id of missing) {
    const label = names.find((n) => n.id === id)?.full_name ?? String(id);
    console.log(`${APPLY ? "ADD" : "would"} + ${label}`);
    if (APPLY) await write("res.users", [user.id], { group_ids: [[4, id]] });
  }

  console.log(APPLY ? "done (apply)" : "dry-run — pass --apply");
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});

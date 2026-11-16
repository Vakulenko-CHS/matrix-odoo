/**
 * T-FAB-01: 8 категорій замовної тканини (відповідь Лізи 2026-11-11).
 *
 *   npm run fab01-categories
 */
import { runAddFabric } from "./addFabric";

/** Дослівно з inbound Лізи — не перейменовувати. */
export const FAB01_CATEGORY_NAMES = [
  "1 категорія до 3$",
  "2 категорія до 4$",
  "3 категорія до 5$",
  "4 категорія до 6$",
  "5 категорія до 7$",
  "6 категорія до 8$",
  "7 категорія до 9$",
  "8 категорія до 10$",
] as const;

async function main(): Promise<void> {
  console.log(`T-FAB-01: ${FAB01_CATEGORY_NAMES.length} категорій\n`);
  for (let i = 0; i < FAB01_CATEGORY_NAMES.length; i++) {
    const name = FAB01_CATEGORY_NAMES[i];
    console.log(`\n>>> [${i + 1}/${FAB01_CATEGORY_NAMES.length}] ${name}`);
    await runAddFabric(name);
  }
  console.log("\n✓ Усі категорії оброблено.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[FATAL]", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

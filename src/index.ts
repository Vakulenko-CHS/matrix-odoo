const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "to-novalid": {
      const { runToNoValid } = await import("./commands/toNoValid");
      await runToNoValid(args[0], args[1]);
      break;
    }

    case "validate": {
      const { runValidate } = await import("./commands/validate");
      await runValidate(args[0]);
      break;
    }

    case "validate-all": {
      const { runValidateAll } = await import("./commands/validateAll");
      await runValidateAll(args[0]);
      break;
    }

    case "snapshot": {
      const { runSnapshot } = await import("./commands/snapshot");
      await runSnapshot(args[0]);
      break;
    }

    case "restore": {
      const { runRestore } = await import("./commands/restore");
      await runRestore(args[0]);
      break;
    }

    case "import": {
      const { runImport } = await import("./commands/importSpec");
      await runImport(args[0]);
      break;
    }

    case "check": {
      const { runCheck } = await import("./commands/check");
      await runCheck(args[0], ...args.slice(1));
      break;
    }

    case "ai-check": {
      const { runAiCheck } = await import("./commands/aiCheck");
      runAiCheck(args);
      break;
    }

    case "add-fabric": {
      const { runAddFabric } = await import("./commands/addFabric");
      await runAddFabric(args[0]);
      break;
    }

    case "bom": {
      const { createAllBoms } = await import("./bom/creator");
      const { neo3Boms } = await import("./specs/neo3-mekhanizm");
      await createAllBoms(neo3Boms);
      break;
    }

    default:
      console.log(`
Використання:
  Локально (Odoo не чіпає):
  npm run to-novalid "<файл>"    — сирий дамп → documents_no_valid
  npm run validate "<файл>"       — авто-форматування + список помилок
  npm run validate-all [папка]   — валідація всіх .md у папці
  npm run web                    — сторінка перевірки специфікації
  npm run ai-check -- "<файл.md>" — звіт помилок у stdout, файли не чіпає

  Жива база (потрібен ODOO_API_KEY в .env):
  npm run import "<файл>"
  npm run check "<продукт>"
  npm run add-fabric "<назва>"
  npm run snapshot [мітка]
  npm run restore
  npm run restore -- "<назва>"
  npm run restore -- all
  npm run dev bom
      `);
  }
}

main().catch((err) => {
  console.error("\n[ПОМИЛКА]", err.message);
  process.exit(1);
});

/**
 * Push local markdown to HackMD notes (API v1).
 *
 *   npm run push-hackmd -- temp/links-2-push.json
 *
 * JSON: [{ "url": "https://hackmd.io/…", "file": "temp/links-2-docs/….md" }, …]
 *
 * Token: HACKMD_API_TOKEN in .env.local (HackMD → Settings → API).
 */
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import * as dotenv from "dotenv";
import { noteIdFromUrl } from "./pull-hackmd";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

interface PushEntry {
  url: string;
  file: string;
}

function usage(): never {
  console.error(
    "Використання: npm run push-hackmd -- <manifest.json>\n" +
      'manifest: [{ "url": "https://hackmd.io/id", "file": "path/to.md" }]\n' +
      "Потрібен HACKMD_API_TOKEN у .env.local",
  );
  process.exit(2);
}

async function updateNote(
  token: string,
  noteId: string,
  content: string,
): Promise<void> {
  const api = `https://api.hackmd.io/v1/notes/${noteId}`;
  await axios.patch(
    api,
    { content },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
      validateStatus: (s) => s >= 200 && s < 300,
    },
  );
}

export async function runPushHackmd(argv: string[]): Promise<void> {
  const manifestPath = argv[0];
  if (!manifestPath) usage();

  const token = process.env.HACKMD_API_TOKEN?.trim();
  if (!token) {
    console.error("HACKMD_API_TOKEN не задано (.env.local).");
    process.exit(2);
  }

  const absManifest = path.resolve(process.cwd(), manifestPath);
  const entries = JSON.parse(fs.readFileSync(absManifest, "utf-8")) as PushEntry[];
  if (!Array.isArray(entries) || !entries.length) {
    console.error("Порожній manifest.");
    process.exit(2);
  }

  let ok = 0;
  for (let i = 0; i < entries.length; i++) {
    const { url, file } = entries[i];
    const noteId = noteIdFromUrl(url);
    if (!noteId) {
      console.error(`SKIP bad url: ${url}`);
      continue;
    }
    const absFile = path.resolve(process.cwd(), file);
    if (!fs.existsSync(absFile)) {
      console.error(`SKIP missing file: ${file}`);
      continue;
    }
    const content = fs.readFileSync(absFile, "utf-8");
    console.log(`[${i + 1}/${entries.length}] PATCH ${noteId} ← ${path.basename(file)}`);
    try {
      await updateNote(token, noteId, content);
      ok++;
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status ?? ""} ${JSON.stringify(err.response?.data ?? err.message)}`
        : String(err);
      console.error(`  FAIL ${noteId}: ${msg}`);
    }
  }
  console.log(`\nOK ${ok}/${entries.length}`);
  if (ok < entries.length) process.exit(1);
}

if (require.main === module) {
  runPushHackmd(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

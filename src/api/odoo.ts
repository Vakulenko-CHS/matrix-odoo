import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const ODOO_URL = process.env.ODOO_URL!;
const ODOO_DB = process.env.ODOO_DB!;
const ODOO_USERNAME = process.env.ODOO_USERNAME!;
const ODOO_API_KEY = process.env.ODOO_API_KEY!;

let _uid: number | null = null;

// Odoo JSON-RPC через /jsonrpc (аналог XML-RPC, але JSON)
async function jsonRpc(service: string, method: string, args: any[]): Promise<any> {
  const response = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: '2.0',
    method: 'call',
    params: { service, method, args },
    id: Date.now(),
  }, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.data.error) {
    throw new Error(`Odoo RPC error: ${JSON.stringify(response.data.error.data?.message || response.data.error)}`);
  }

  return response.data.result;
}

export async function authenticate(): Promise<number> {
  if (_uid !== null) return _uid;

  if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_API_KEY) {
    throw new Error(
      "Odoo вимкнено: порожній ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_API_KEY. " +
        "Розкоментуй ключ у .env лише коли треба жива база.",
    );
  }

  const uid = await jsonRpc("common", "authenticate", [
    ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {},
  ]);

  if (!uid) throw new Error('Odoo authentication failed. Перевірте .env credentials.');

  _uid = uid;
  console.log(`[OK] Підключено до Odoo (UID: ${uid})`);
  return uid;
}

export async function executeKw<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: object = {}
): Promise<T> {
  const uid = await authenticate();

  return jsonRpc('object', 'execute_kw', [
    ODOO_DB, uid, ODOO_API_KEY,
    model, method, args,
    { context: { lang: 'uk_UA' }, ...kwargs },
  ]);
}

export async function searchRead<T = any>(
  model: string,
  domain: any[][] = [],
  fields: string[] = [],
  limit = 0
): Promise<T[]> {
  return executeKw<T[]>(model, 'search_read', [domain], { fields, limit });
}

export async function search(model: string, domain: any[][]): Promise<number[]> {
  return executeKw<number[]>(model, 'search', [domain]);
}

export async function create(model: string, vals: object): Promise<number> {
  return executeKw<number>(model, 'create', [vals]);
}

/** Batch create — Odoo 16+ accepts a list and returns list of IDs in the same order */
export async function createMany(model: string, vals: object[]): Promise<number[]> {
  if (vals.length === 0) return [];
  return executeKw<number[]>(model, 'create', [vals]);
}

export async function write(model: string, ids: number[], vals: object): Promise<boolean> {
  return executeKw<boolean>(model, 'write', [ids, vals]);
}

export async function unlink(model: string, ids: number[]): Promise<boolean> {
  return executeKw<boolean>(model, 'unlink', [ids]);
}

export async function fieldsGet(model: string, attributes = ['type', 'selection']): Promise<Record<string, any>> {
  return executeKw(model, 'fields_get', [], { attributes });
}

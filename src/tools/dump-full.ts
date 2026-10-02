/**
 * Maximal read-only Odoo extract for disaster rebuild (not 1:1 DB restore).
 *
 *   npm run dump-full
 *
 * Writes temp/full-dump/<timestamp>/ (gitignored).
 * Requests only fields that exist on the live model (Odoo 19-safe).
 */
import * as fs from "fs";
import * as path from "path";
import { authenticate, executeKw } from "../api/odoo";
import { searchReadPaged, sleep, withRetry } from "./odooPaged";

interface DumpSpec {
  file: string;
  model: string;
  fields: string[];
  domain?: unknown[];
  activeTest?: boolean;
  optional?: boolean;
}

const SPECS: DumpSpec[] = [
  {
    file: "product.category.json",
    model: "product.category",
    fields: ["id", "name", "complete_name", "parent_id"],
  },
  {
    file: "uom.uom.json",
    model: "uom.uom",
    fields: [
      "id",
      "name",
      "factor",
      "relative_factor",
      "relative_uom_id",
      "category_id",
      "uom_type",
      "active",
    ],
    activeTest: false,
  },
  {
    file: "product.attribute.json",
    model: "product.attribute",
    fields: ["id", "name", "create_variant", "display_type", "value_ids"],
  },
  {
    file: "product.attribute.value.json",
    model: "product.attribute.value",
    fields: ["id", "name", "attribute_id", "sequence", "is_custom"],
  },
  {
    file: "product.template.json",
    model: "product.template",
    fields: [
      "id",
      "name",
      "default_code",
      "type",
      "categ_id",
      "uom_id",
      "uom_po_id",
      "active",
      "sale_ok",
      "purchase_ok",
      "route_ids",
      "attribute_line_ids",
      "product_variant_ids",
      "product_variant_count",
      "description",
      "list_price",
      "standard_price",
    ],
    activeTest: false,
  },
  {
    file: "product.template.attribute.line.json",
    model: "product.template.attribute.line",
    fields: [
      "id",
      "product_tmpl_id",
      "attribute_id",
      "value_ids",
      "product_template_value_ids",
    ],
  },
  {
    file: "product.template.attribute.value.json",
    model: "product.template.attribute.value",
    fields: [
      "id",
      "product_tmpl_id",
      "attribute_line_id",
      "attribute_id",
      "product_attribute_value_id",
      "name",
      "ptav_active",
    ],
  },
  {
    file: "product.product.json",
    model: "product.product",
    fields: [
      "id",
      "name",
      "display_name",
      "default_code",
      "product_tmpl_id",
      "product_template_attribute_value_ids",
      "active",
      "barcode",
      "uom_id",
      "type",
    ],
    activeTest: false,
  },
  {
    file: "mrp.bom.json",
    model: "mrp.bom",
    fields: [
      "id",
      "code",
      "product_tmpl_id",
      "product_id",
      "product_qty",
      "product_uom_id",
      "type",
      "bom_line_ids",
      "operation_ids",
      "active",
    ],
    activeTest: false,
  },
  {
    file: "mrp.bom.line.json",
    model: "mrp.bom.line",
    fields: [
      "id",
      "bom_id",
      "product_id",
      "product_tmpl_id",
      "product_qty",
      "product_uom_id",
      "operation_id",
      "sequence",
    ],
  },
  {
    file: "mrp.routing.workcenter.json",
    model: "mrp.routing.workcenter",
    fields: [
      "id",
      "name",
      "bom_id",
      "workcenter_id",
      "time_cycle_manual",
      "sequence",
      "worksheet_type",
      "active",
    ],
  },
  {
    file: "mrp.workcenter.json",
    model: "mrp.workcenter",
    fields: ["id", "name", "code", "active", "resource_calendar_id"],
    activeTest: false,
  },
  {
    file: "stock.route.json",
    model: "stock.route",
    fields: [
      "id",
      "name",
      "active",
      "product_selectable",
      "product_categ_selectable",
      "warehouse_selectable",
      "rule_ids",
    ],
    activeTest: false,
    optional: true,
  },
  {
    file: "stock.rule.json",
    model: "stock.rule",
    fields: [
      "id",
      "name",
      "route_id",
      "action",
      "location_src_id",
      "location_dest_id",
      "picking_type_id",
      "procure_method",
      "active",
    ],
    activeTest: false,
    optional: true,
  },
  {
    file: "stock.location.json",
    model: "stock.location",
    fields: [
      "id",
      "name",
      "complete_name",
      "usage",
      "location_id",
      "warehouse_id",
      "active",
    ],
    activeTest: false,
    optional: true,
  },
  {
    file: "stock.quant.json",
    model: "stock.quant",
    fields: [
      "id",
      "product_id",
      "location_id",
      "quantity",
      "reserved_quantity",
      "lot_id",
      "package_id",
      "owner_id",
    ],
    optional: true,
  },
  {
    file: "mrp.production.json",
    model: "mrp.production",
    fields: [
      "id",
      "name",
      "product_id",
      "product_tmpl_id",
      "product_qty",
      "product_uom_id",
      "bom_id",
      "state",
      "date_start",
      "date_finished",
      "origin",
    ],
    optional: true,
  },
];

async function existingFields(model: string, want: string[]): Promise<string[]> {
  const meta = await withRetry("dump-full", () =>
    executeKw<Record<string, unknown>>(model, "fields_get", [], {
      attributes: ["type"],
    }),
  );
  const have = new Set(Object.keys(meta));
  const ok = want.filter((f) => have.has(f));
  if (!ok.includes("id") && have.has("id")) ok.unshift("id");
  return ok;
}

async function main(): Promise<void> {
  console.log("[dump-full] read-only. Odoo write не викликаємо.");
  await authenticate();
  await sleep(250);

  const when = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.resolve("temp", "full-dump", when);
  fs.mkdirSync(dir, { recursive: true });

  const manifest: Array<{
    file: string;
    model: string;
    count: number;
    fields: string[];
    skipped?: string;
  }> = [];

  for (const spec of SPECS) {
    try {
      const fields = await existingFields(spec.model, spec.fields);
      await sleep(150);
      const rows = await searchReadPaged<Record<string, unknown>>(
        spec.model,
        fields,
        {
          domain: spec.domain,
          activeTest: spec.activeTest ?? true,
          label: "dump-full",
        },
      );
      const filePath = path.join(dir, spec.file);
      fs.writeFileSync(filePath, `${JSON.stringify(rows)}\n`, "utf-8");
      manifest.push({
        file: spec.file,
        model: spec.model,
        count: rows.length,
        fields,
      });
      console.log(`[dump-full] ${spec.file}: ${rows.length}`);
      await sleep(250);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (spec.optional) {
        console.warn(`[dump-full] skip ${spec.model}: ${msg.slice(0, 120)}`);
        manifest.push({
          file: spec.file,
          model: spec.model,
          count: 0,
          fields: [],
          skipped: msg.slice(0, 200),
        });
        continue;
      }
      throw err;
    }
  }

  const readme = [
    "# Full Odoo API dump",
    "",
    `When: ${when}`,
    "Read-only extract. Not a native Odoo DB restore.",
    "Use to rebuild catalog (templates, attrs, BOM) via scripts.",
    "Stock moves / accounting / chatter are not fully recoverable from this.",
    "",
    "## Files",
    "",
    ...manifest.map((m) =>
      m.skipped
        ? `- ${m.file} — SKIPPED (${m.skipped})`
        : `- ${m.file} — ${m.count} rows (${m.fields.length} fields)`,
    ),
    "",
  ].join("\n");

  fs.writeFileSync(path.join(dir, "README.md"), readme, "utf-8");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    `${JSON.stringify({ when, models: manifest }, null, 2)}\n`,
    "utf-8",
  );

  console.log("");
  console.log(`[dump-full] ${dir}`);
  console.log(
    `[dump-full] models ok: ${manifest.filter((m) => !m.skipped).length} / ${manifest.length}`,
  );
}

main().catch((err) => {
  console.error("[dump-full]", err instanceof Error ? err.message : err);
  process.exit(1);
});

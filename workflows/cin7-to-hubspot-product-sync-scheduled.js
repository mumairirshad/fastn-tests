export default async function (ctx) {
  const { input } = ctx;
  const CONFIG_TEMPLATE_ID = "cfg_832a2ec165ec";
  const SOURCE_ENTITY = "product";
  const TARGET_ENTITY = "product";
  const STATE_PREFIX = "cin7hs-v3:product:rec:";
  const CURSOR_KEY = "cin7hs-v3:product:cursor";

  function passesConditions(record, conditions) {
    for (const c of conditions || []) {
      const val = record[c.field];
      if (c.operator === "equals") {
        if (String(val) !== String(c.value)) return { pass: false, reason: `${c.field} != ${c.value}` };
      }
    }
    return { pass: true, reason: null };
  }

  function buildProperties(record, mappings) {
    const props = {};
    for (const m of mappings || []) {
      let value = record[m.sourceField];
      if (m.valueMappings && m.valueMappings.length) {
        const vm = m.valueMappings.find((x) => x.sourceValue === value);
        value = vm ? vm.targetValue : value;
      }
      const key = m.targetField.startsWith("properties.") ? m.targetField.slice("properties.".length) : m.targetField;
      props[key] = value;
    }
    return props;
  }

  const isManualRun = !!(input && (input.limit || input.maxPages || input.modifiedSince));
  const pageSize = (input && input.limit) || 100;
  const maxPages = (input && input.maxPages) || 200;

  const config = await fastn.config.getByTemplate(CONFIG_TEMPLATE_ID);
  const flows = config.entities ?? config.directions ?? [];
  const dir =
    flows.find(
      (d) => (d.source?.entity ?? d.sourceEntity) === SOURCE_ENTITY && (d.target?.entity ?? d.targetEntity) === TARGET_ENTITY
    ) ?? flows[0];
  if (!dir) throw new Error("No Cin7->HubSpot product direction found in config " + CONFIG_TEMPLATE_ID);

  let cursor = null;
  if (isManualRun) {
    if (input.modifiedSince) cursor = input.modifiedSince;
  } else {
    cursor = await fastn.state.get(CURSOR_KEY);
  }

  let created = 0,
    updated = 0,
    skipped = 0,
    errors = 0;
  const errorDetails = [];
  let latestModified = cursor || null;

  for (let page = 1; page <= maxPages; page++) {
    const params = { Page: page, Limit: pageSize };
    if (cursor) params.ModifiedSince = cursor;

    let listRes;
    try {
      listRes = await fastn.connector.cin7core.listProducts(params);
    } catch (e) {
      errors++;
      errorDetails.push({ sourceId: null, sku: null, reason: "list_page_failed", errorMessage: String(e.message || e) });
      break;
    }
    const records = listRes.output?.Products ?? [];
    if (!records.length) break;

    for (const record of records) {
      const stateKey = STATE_PREFIX + record.ID;
      try {
        const check = passesConditions(record, dir.conditions);
        if (!check.pass) {
          skipped++;
          await fastn.state.set(stateKey, {
            sku: record.SKU,
            status: "skipped",
            reason: check.reason,
            data: record,
            syncedAt: new Date().toISOString(),
          });
          continue;
        }

        const properties = buildProperties(record, dir.mappings);
        const hash = `${record.LastModifiedOn || ""}:${JSON.stringify(properties).length}`;
        const cached = await fastn.state.get(stateKey);

        if (cached && cached.hash === hash && cached.target_id) {
          skipped++;
          await fastn.state.set(stateKey, { ...cached, status: "skipped", syncedAt: new Date().toISOString() });
          continue;
        }

        let targetId = cached?.target_id;
        let didCreate = false;

        if (targetId) {
          try {
            await fastn.connector.hubspot.updateProduct({ productId: targetId, properties });
          } catch (e) {
            if (/404|410|not\s*found/i.test(String(e.message || e))) {
              targetId = null;
            } else {
              throw e;
            }
          }
        }

        if (!targetId) {
          const searchRes = await fastn.connector.hubspot.searchProducts({
            filterGroups: [{ filters: [{ propertyName: "hs_sku", operator: "EQ", value: record.SKU }] }],
          });
          const found = (searchRes.output?.results || []).find((r) => r.properties?.hs_sku === record.SKU) || searchRes.output?.results?.[0];
          if (found) {
            targetId = found.id;
            await fastn.connector.hubspot.updateProduct({ productId: targetId, properties });
          } else {
            const createRes = await fastn.connector.hubspot.createProduct({ properties });
            targetId = createRes.output?.id;
            didCreate = true;
          }
        }

        await fastn.state.set(stateKey, {
          sku: record.SKU,
          hash,
          target_id: targetId,
          status: didCreate ? "created" : "updated",
          data: record,
          syncedAt: new Date().toISOString(),
        });
        if (didCreate) created++;
        else updated++;

        if (record.LastModifiedOn && (!latestModified || record.LastModifiedOn > latestModified)) {
          latestModified = record.LastModifiedOn;
        }
      } catch (err) {
        errors++;
        errorDetails.push({ sourceId: record.ID, sku: record.SKU, reason: "sync_error", errorMessage: String(err.message || err) });
      }
    }

    if (records.length < pageSize) break;
  }

  if (!isManualRun && latestModified) {
    await fastn.state.set(CURSOR_KEY, latestModified);
  }

  return { created, updated, skipped, errors, errorDetails };
}

export default async function (ctx) {
  const { input } = ctx;
  const CONFIG_TEMPLATE_ID = "cfg_832a2ec165ec";
  const SOURCE_ENTITY = "product";
  const TARGET_ENTITY = "product";
  const STATE_PREFIX = "cin7hs-v3:product:rec:";

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

  const sku = input?.SKU || null;
  const productId = input?.ProductID || null;

  if (!sku && !productId) {
    return { created: 0, updated: 0, skipped: 1, errors: 0, errorDetails: [], reason: "event payload had no SKU or ProductID" };
  }

  const config = await fastn.config.getByTemplate(CONFIG_TEMPLATE_ID);
  const flows = config.entities ?? config.directions ?? [];
  const dir =
    flows.find(
      (d) => (d.source?.entity ?? d.sourceEntity) === SOURCE_ENTITY && (d.target?.entity ?? d.targetEntity) === TARGET_ENTITY
    ) ?? flows[0];
  if (!dir) throw new Error("No Cin7->HubSpot product direction found in config " + CONFIG_TEMPLATE_ID);

  const listRes = await fastn.connector.cin7core.listProducts(sku ? { SKU: sku, Limit: 5 } : { ID: productId, Limit: 5 });
  const candidates = listRes.output?.Products ?? [];
  const record = candidates.find((r) => (sku && r.SKU === sku) || (productId && r.ID === productId)) ?? candidates[0];

  if (!record) {
    return { created: 0, updated: 0, skipped: 1, errors: 0, errorDetails: [], reason: "product not found in Cin7 for this event" };
  }

  const stateKey = STATE_PREFIX + record.ID;

  const check = passesConditions(record, dir.conditions);
  if (!check.pass) {
    await fastn.state.set(stateKey, {
      sku: record.SKU,
      status: "skipped",
      reason: check.reason,
      data: record,
      syncedAt: new Date().toISOString(),
    });
    return { created: 0, updated: 0, skipped: 1, errors: 0, errorDetails: [] };
  }

  const properties = buildProperties(record, dir.mappings);
  const cached = await fastn.state.get(stateKey);
  let targetId = cached?.target_id;
  let didCreate = false;
  let errors = 0;
  const errorDetails = [];

  try {
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
    const hash = `${record.LastModifiedOn || ""}:${JSON.stringify(properties).length}`;
    await fastn.state.set(stateKey, {
      sku: record.SKU,
      hash,
      target_id: targetId,
      status: didCreate ? "created" : "updated",
      data: record,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    errors++;
    errorDetails.push({ sourceId: record.ID, sku: record.SKU, reason: "sync_error", errorMessage: String(err.message || err) });
  }

  return { created: didCreate ? 1 : 0, updated: !didCreate && targetId && errors === 0 ? 1 : 0, skipped: 0, errors, errorDetails };
}

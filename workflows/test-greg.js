export default async function(ctx) {
  const { input, headers } = ctx;
  // Your workflow logic here

  const up = await fastn.connector.hubspot.batchUpsertProducts({ inputs: chunk });

  return { result: "Hello from workflow!", input };
}
export default async function(ctx) {
  const { input, headers } = ctx;
  // Your workflow logic here
  return { result: "This is HP-poc1", input };
}
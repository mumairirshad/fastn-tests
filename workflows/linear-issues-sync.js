export default async function (ctx) {
  const { input, call } = ctx;

  const response = await call("list_issues", {
    limit: input.limit ?? 10,
  });

  return {
    issues: (response.data ?? []).map((issue) => issue.title),
  };
}
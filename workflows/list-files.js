export default async function (ctx) {
  const { input, headers } = ctx;

  const res = await fastn.connector.googleDrive.listFiles({
    pageSize: 10
  });

  return { result: "Google Drive files listed", files: res, input };
}
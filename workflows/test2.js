export default async function (ctx) {
  const { input, headers } = ctx;

  const name = input;

  const res = await fastn.connector.intercom.listContacts({
    query: {
      field: "name",
      operator: "~",
      value: name
    }
  });

  return { result: "Intercom contacts listed23232323", name, contacts: res, input };
}
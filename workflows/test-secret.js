  export default async function (ctx) {
    const raw = await ctx.secrets.get('ENVIRONMENT');
    const value = (raw ?? '').trim().toUpperCase();   // DEV / LIVE / HP

    const map = {
      DEV:  'this is dev',
      LIVE: 'this is live',
      HP:   'this is hp',
    };

    return { message: map[value] ?? `unknown environment: ${raw ?? '(not set)'}` };
  }
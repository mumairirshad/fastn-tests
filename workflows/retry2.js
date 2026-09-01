export default async function (ctx) {
    // record every attempt so you can inspect the retry history afterwards
    const key = 'qaretry_' + ctx.input.rid;
    const log = (await fastn.state.get(key, { scope: 'ORG' })) || [];
    log.push({ attempt: ctx.attempt, isRetry: ctx.isRetry, at: Date.now() });
    await fastn.state.set(key, log, { scope: 'ORG' });

    // Force a RETRYABLE failure: message matches the transient-DB regex →
    // reclassified SystemError (503, retryable). A plain throw would be
    // UserCodeError (422) and would NOT retry.
    throw new Error('ECONNRESET: connection reset (simulated 5xx for retry test)');
  }
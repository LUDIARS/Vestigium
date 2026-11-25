const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type ServiceAliases = { time: string; msg: string };

export default {
  post(result: ServiceAliases | undefined, row: Record<string, unknown>): true | string {
    const nativeTime = typeof row.ts === 'number' ? new Date(row.ts) : undefined;
    const alias = (value: unknown): string | undefined => {
      if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return undefined;
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    };
    const time = nativeTime && Number.isFinite(nativeTime.getTime()) ? nativeTime.toISOString()
      : alias(row.timestamp) ?? alias(row.time);
    const message = [row.msg, row.event, row.message].find((value) => typeof value === 'string');
    if (!time || typeof message !== 'string') {
      return result === undefined || 'invalid service aliases were resolved';
    }
    return (result?.time === time && result.msg === message)
      || 'resolved service aliases do not match the input';
  },
};

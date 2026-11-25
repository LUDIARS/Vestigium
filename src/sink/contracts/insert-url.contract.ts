export default {
  post: (url: URL, origin: string): true | string =>
    (url.origin === new URL(origin).origin
      && url.pathname === '/insert/jsonline'
      && url.searchParams.get('_time_field') === '_time'
      && url.searchParams.get('_msg_field') === '_msg'
      && url.searchParams.get('_stream_fields') === 'service,kind')
    || 'JSONL ingestion URL does not preserve the origin and field mapping',
};

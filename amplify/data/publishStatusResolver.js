// Passthrough AppSync JS resolver on a NONE data source: echoes the mutation
// arguments back as the result so the subscription linked to this mutation
// (onAccessRequestStatusChanged) broadcasts them to subscribers.
export function request(ctx) {
  return { payload: ctx.args };
}

export function response(ctx) {
  return ctx.result;
}

import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Define your data model and authorization rules.
 * @see https://docs.amplify.aws/gen2/build-a-backend/data
 */
const schema = a.schema({
  Todo: a
    .model({
      content: a.string(),
      done: a.boolean(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});

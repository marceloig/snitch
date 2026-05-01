import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import {
  listIDCUsersFunction,
  listIDCGroupsFunction,
  listAWSAccountsFunction,
  listOUsFunction,
  listPermissionSetsFunction,
} from "../functions/awsResources/resource";
import {
  createPrivilegedPolicyFunction,
  updatePrivilegedPolicyFunction,
  deletePrivilegedPolicyFunction,
} from "../functions/verifiedPermissions/resource";

const schema = a.schema({
  PrincipalType: a.enum(["USER", "GROUP"]),

  PrivilegedPolicy: a
    .model({
      name: a.string().required(),
      description: a.string(),
      principalType: a.ref("PrincipalType"),
      principalId: a.string().required(),
      principalDisplayName: a.string(),
      accountIds: a.string().array(),
      ouIds: a.string().array(),
      permissionSetArns: a.string().array(),
      permissionSetNames: a.string().array(),
      avpPolicyId: a.string(),
    })
    .authorization((allow) => [allow.group("Admins")]),

  // Custom types returned by Lambda queries
  IDCUser: a.customType({
    id: a.string(),
    userName: a.string(),
    displayName: a.string(),
    email: a.string(),
  }),

  IDCGroup: a.customType({
    id: a.string(),
    displayName: a.string(),
    description: a.string(),
  }),

  AWSAccount: a.customType({
    id: a.string(),
    name: a.string(),
    email: a.string(),
    status: a.string(),
  }),

  OrganizationalUnit: a.customType({
    id: a.string(),
    name: a.string(),
    arn: a.string(),
  }),

  PermissionSet: a.customType({
    arn: a.string(),
    name: a.string(),
    description: a.string(),
  }),

  listIDCUsers: a
    .query()
    .returns(a.ref("IDCUser").array())
    .handler(a.handler.function(listIDCUsersFunction))
    .authorization((allow) => [allow.group("Admins")]),

  listIDCGroups: a
    .query()
    .returns(a.ref("IDCGroup").array())
    .handler(a.handler.function(listIDCGroupsFunction))
    .authorization((allow) => [allow.group("Admins")]),

  listAWSAccounts: a
    .query()
    .returns(a.ref("AWSAccount").array())
    .handler(a.handler.function(listAWSAccountsFunction))
    .authorization((allow) => [allow.group("Admins")]),

  listOUs: a
    .query()
    .returns(a.ref("OrganizationalUnit").array())
    .handler(a.handler.function(listOUsFunction))
    .authorization((allow) => [allow.group("Admins")]),

  listPermissionSets: a
    .query()
    .returns(a.ref("PermissionSet").array())
    .handler(a.handler.function(listPermissionSetsFunction))
    .authorization((allow) => [allow.group("Admins")]),

  // AVP-backed mutations — named with suffix to avoid clashing with the
  // auto-generated model mutations (createPrivilegedPolicy etc.)
  createPrivilegedPolicyWithAVP: a
    .mutation()
    .arguments({
      name: a.string().required(),
      description: a.string(),
      principalType: a.ref("PrincipalType"),
      principalId: a.string().required(),
      principalDisplayName: a.string(),
      accountIds: a.string().array(),
      ouIds: a.string().array(),
      permissionSetArns: a.string().array(),
      permissionSetNames: a.string().array(),
    })
    .returns(a.ref("PrivilegedPolicy"))
    .handler(a.handler.function(createPrivilegedPolicyFunction))
    .authorization((allow) => [allow.group("Admins")]),

  updatePrivilegedPolicyWithAVP: a
    .mutation()
    .arguments({
      id: a.string().required(),
      name: a.string().required(),
      description: a.string(),
      principalType: a.ref("PrincipalType"),
      principalId: a.string().required(),
      principalDisplayName: a.string(),
      accountIds: a.string().array(),
      ouIds: a.string().array(),
      permissionSetArns: a.string().array(),
      permissionSetNames: a.string().array(),
    })
    .returns(a.ref("PrivilegedPolicy"))
    .handler(a.handler.function(updatePrivilegedPolicyFunction))
    .authorization((allow) => [allow.group("Admins")]),

  deletePrivilegedPolicyWithAVP: a
    .mutation()
    .arguments({ id: a.string().required() })
    .returns(a.boolean())
    .handler(a.handler.function(deletePrivilegedPolicyFunction))
    .authorization((allow) => [allow.group("Admins")]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});

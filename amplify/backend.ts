import { defineBackend } from "@aws-amplify/backend";
import { CfnUserPoolGroup } from "aws-cdk-lib/aws-cognito";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { CfnPolicyStore } from "aws-cdk-lib/aws-verifiedpermissions";
import { setupAccessRequestWorkflow } from "./accessRequestWorkflow";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import {
  getMyIDCUserFunction,
  listIDCUsersFunction,
  listIDCGroupsFunction,
  listAWSAccountsFunction,
  listOUsFunction,
  listPermissionSetsFunction,
} from "./functions/awsResources/resource";
import {
  createPrivilegedPolicyFunction,
  updatePrivilegedPolicyFunction,
  deletePrivilegedPolicyFunction,
  evaluateAccessFunction,
} from "./functions/verifiedPermissions/resource";
import {
  requestAccessFunction,
  listAccessRequestsFunction,
  assignPermissionSetFunction,
  removePermissionSetFunction,
  setStatusFailedFunction,
} from "./functions/accessRequests/resource";

const backend = defineBackend({
  auth,
  data,
  getMyIDCUserFunction,
  listIDCUsersFunction,
  listIDCGroupsFunction,
  listAWSAccountsFunction,
  listOUsFunction,
  listPermissionSetsFunction,
  createPrivilegedPolicyFunction,
  updatePrivilegedPolicyFunction,
  deletePrivilegedPolicyFunction,
  evaluateAccessFunction,
  requestAccessFunction,
  listAccessRequestsFunction,
  assignPermissionSetFunction,
  removePermissionSetFunction,
  setStatusFailedFunction,
});

// ─── Cognito Admins group ─────────────────────────────────────────────────────

const { userPool } = backend.auth.resources;
new CfnUserPoolGroup(userPool, "AdminsGroup", {
  userPoolId: userPool.userPoolId,
  groupName: "Admins",
  description: "Administrators with access to privileged policies",
});

// ─── AWS resource Lambda permissions ─────────────────────────────────────────

const awsResourcePolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    "sso:ListInstances",
    "sso:ListPermissionSets",
    "sso:DescribePermissionSet",
    "identitystore:ListUsers",
    "identitystore:ListGroups",
    "organizations:ListAccounts",
    "organizations:ListRoots",
    "organizations:ListOrganizationalUnitsForParent",
  ],
  resources: ["*"],
});

for (const fn of [
  backend.getMyIDCUserFunction,
  backend.listIDCUsersFunction,
  backend.listIDCGroupsFunction,
  backend.listAWSAccountsFunction,
  backend.listOUsFunction,
  backend.listPermissionSetsFunction,
]) {
  fn.resources.lambda.addToRolePolicy(awsResourcePolicy);
}

// getMyIDCUser additionally needs to look up the Cognito user by sub to
// retrieve the email attribute — required because AppSync may forward the
// access token (which has no email claim) instead of the ID token.
backend.getMyIDCUserFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["cognito-idp:AdminGetUser"],
    resources: [userPool.userPoolArn],
  })
);
(backend.getMyIDCUserFunction.resources.lambda as LambdaFunction).addEnvironment(
  "AUTH_USER_POOL_ID",
  userPool.userPoolId
);

// ─── Verified Permissions policy store ───────────────────────────────────────

// Cedar schema for the Snitch namespace:
//   Principal — Snitch::User (memberOf Group) | Snitch::Group
//   Resource  — Snitch::Account (memberOf OU) | Snitch::OU (memberOf OU)
//   Action    — Snitch::Action::"assume" with required context.permissionSetArn
const cedarSchema = {
  Snitch: {
    entityTypes: {
      User: { memberOfTypes: ["Group"] },
      Group: { memberOfTypes: [] },
      Account: { memberOfTypes: ["OU"] },
      OU: { memberOfTypes: ["OU"] },
    },
    actions: {
      assume: {
        appliesTo: {
          principalTypes: ["User", "Group"],
          resourceTypes: ["Account", "OU"],
          context: {
            type: "Record",
            attributes: {
              permissionSetArn: { type: "String", required: true },
            },
          },
        },
      },
    },
  },
};

// Scoped to the PrivilegedPolicy DynamoDB table so it lives in the data stack.
const policyStore = new CfnPolicyStore(
  backend.data.resources.tables["PrivilegedPolicy"],
  "PrivilegedPolicyStore",
  {
    validationSettings: { mode: "STRICT" },
    schema: { cedarJson: JSON.stringify(cedarSchema) },
    description: "Stores Cedar policies that authorise IDC principals to access AWS accounts",
  }
);

const policyStoreArn = policyStore.attrArn;
const policyStoreId = policyStore.attrPolicyStoreId;

const avpPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    "verifiedpermissions:CreatePolicy",
    "verifiedpermissions:UpdatePolicy",
    "verifiedpermissions:DeletePolicy",
  ],
  resources: [policyStoreArn],
});

const privilegedPolicyTable = backend.data.resources.tables["PrivilegedPolicy"];

const privilegedPolicyDdbPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
  ],
  resources: [privilegedPolicyTable.tableArn],
});

const conflictCheckDdbPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["dynamodb:Scan"],
  resources: [privilegedPolicyTable.tableArn],
});

for (const fn of [
  backend.createPrivilegedPolicyFunction,
  backend.updatePrivilegedPolicyFunction,
  backend.deletePrivilegedPolicyFunction,
]) {
  fn.resources.lambda.addToRolePolicy(avpPolicy);
  fn.resources.lambda.addToRolePolicy(privilegedPolicyDdbPolicy);
  (fn.resources.lambda as LambdaFunction).addEnvironment("AVP_POLICY_STORE_ID", policyStoreId);
  (fn.resources.lambda as LambdaFunction).addEnvironment(
    "PRIVILEGED_POLICY_TABLE_NAME",
    privilegedPolicyTable.tableName
  );
}

for (const fn of [
  backend.createPrivilegedPolicyFunction,
  backend.updatePrivilegedPolicyFunction,
]) {
  fn.resources.lambda.addToRolePolicy(conflictCheckDdbPolicy);
}

backend.evaluateAccessFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["verifiedpermissions:IsAuthorized"],
    resources: [policyStoreArn],
  })
);
backend.evaluateAccessFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:Scan"],
    resources: [privilegedPolicyTable.tableArn],
  })
);
backend.evaluateAccessFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "sso:ListInstances",
      "identitystore:ListUsers",
      "identitystore:ListGroupMembershipsForMember",
    ],
    resources: ["*"],
  })
);
(backend.evaluateAccessFunction.resources.lambda as LambdaFunction).addEnvironment(
  "AVP_POLICY_STORE_ID",
  policyStoreId
);
(backend.evaluateAccessFunction.resources.lambda as LambdaFunction).addEnvironment(
  "PRIVILEGED_POLICY_TABLE_NAME",
  privilegedPolicyTable.tableName
);

// ─── Access Request workflow ──────────────────────────────────────────────────

setupAccessRequestWorkflow(backend);

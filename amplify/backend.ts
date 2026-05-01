import { defineBackend } from "@aws-amplify/backend";
import { CfnUserPoolGroup } from "aws-cdk-lib/aws-cognito";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { CfnPolicyStore } from "aws-cdk-lib/aws-verifiedpermissions";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import {
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
} from "./functions/verifiedPermissions/resource";

const backend = defineBackend({
  auth,
  data,
  listIDCUsersFunction,
  listIDCGroupsFunction,
  listAWSAccountsFunction,
  listOUsFunction,
  listPermissionSetsFunction,
  createPrivilegedPolicyFunction,
  updatePrivilegedPolicyFunction,
  deletePrivilegedPolicyFunction,
});

// Admins Cognito group
const { userPool } = backend.auth.resources;
new CfnUserPoolGroup(userPool, "AdminsGroup", {
  userPoolId: userPool.userPoolId,
  groupName: "Admins",
  description: "Administrators with access to privileged policies",
});

// IAM permissions shared by all AWS-resource Lambda functions
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
  backend.listIDCUsersFunction,
  backend.listIDCGroupsFunction,
  backend.listAWSAccountsFunction,
  backend.listOUsFunction,
  backend.listPermissionSetsFunction,
]) {
  fn.resources.lambda.addToRolePolicy(awsResourcePolicy);
}

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

// AWS Verified Permissions Policy Store (STRICT schema validation).
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

// IAM policy for the three Verified Permissions Lambda functions
const avpPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    "verifiedpermissions:CreatePolicy",
    "verifiedpermissions:UpdatePolicy",
    "verifiedpermissions:DeletePolicy",
  ],
  resources: [policyStoreArn],
});

// DynamoDB table reference for direct reads/writes from Lambda
const privilegedPolicyTable = backend.data.resources.tables["PrivilegedPolicy"];

const ddbPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
  ],
  resources: [privilegedPolicyTable.tableArn],
});

for (const fn of [
  backend.createPrivilegedPolicyFunction,
  backend.updatePrivilegedPolicyFunction,
  backend.deletePrivilegedPolicyFunction,
]) {
  fn.resources.lambda.addToRolePolicy(avpPolicy);
  fn.resources.lambda.addToRolePolicy(ddbPolicy);
  (fn.resources.lambda as LambdaFunction).addEnvironment("AVP_POLICY_STORE_ID", policyStoreId);
  (fn.resources.lambda as LambdaFunction).addEnvironment(
    "PRIVILEGED_POLICY_TABLE_NAME",
    privilegedPolicyTable.tableName
  );
}

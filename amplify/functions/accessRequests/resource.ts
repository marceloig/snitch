import { defineFunction } from "@aws-amplify/backend";

const TIMEOUT = 30;

// All four functions use resourceGroupName: "AccessRequestWorkflow" so they
// land in the same nested stack as the Step Function and DynamoDB table
// defined in backend.ts. This keeps all workflow resources in one stack and
// avoids any circular dependency with the data stack.
export const requestAccessFunction = defineFunction({
  name: "requestAccess",
  entry: "./requestAccessHandler.ts",
  timeoutSeconds: TIMEOUT,
  resourceGroupName: "AccessRequestWorkflow",
});

export const listAccessRequestsFunction = defineFunction({
  name: "listAccessRequests",
  entry: "./listAccessRequestsHandler.ts",
  timeoutSeconds: TIMEOUT,
  resourceGroupName: "AccessRequestWorkflow",
});

export const assignPermissionSetFunction = defineFunction({
  name: "assignPermissionSet",
  entry: "./assignPermissionSetHandler.ts",
  timeoutSeconds: 60,
  resourceGroupName: "AccessRequestWorkflow",
});

export const removePermissionSetFunction = defineFunction({
  name: "removePermissionSet",
  entry: "./removePermissionSetHandler.ts",
  timeoutSeconds: 60,
  resourceGroupName: "AccessRequestWorkflow",
});

export const setStatusFailedFunction = defineFunction({
  name: "setStatusFailed",
  entry: "./setStatusFailedHandler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "AccessRequestWorkflow",
});

export const storeApprovalTokenFunction = defineFunction({
  name: "storeApprovalToken",
  entry: "./storeApprovalTokenHandler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "AccessRequestWorkflow",
});

// Approval functions are in the data stack so AppSync can reference them
// without creating a circular dependency with AccessRequestWorkflow.
export const approveRequestFunction = defineFunction({
  name: "approveRequest",
  entry: "./approveRequestHandler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});

export const rejectRequestFunction = defineFunction({
  name: "rejectRequest",
  entry: "./rejectRequestHandler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});

export const listPendingApprovalsFunction = defineFunction({
  name: "listPendingApprovals",
  entry: "./listPendingApprovalsHandler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});

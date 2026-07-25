import type { DynamoDBRecord, DynamoDBStreamHandler } from "aws-lambda";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const GRAPHQL_URL = process.env.APPSYNC_GRAPHQL_URL!;

export type AccessRequestStatusChange = {
  requestId: string;
  status: string;
  updatedAt: string;
};

const PUBLISH_MUTATION = `
  mutation PublishAccessRequestStatus($requestId: String!, $status: String!, $updatedAt: String) {
    publishAccessRequestStatus(requestId: $requestId, status: $status, updatedAt: $updatedAt) {
      requestId
      status
      updatedAt
    }
  }
`;

/**
 * Reduces a batch of stream records to one status change per request.
 *
 * Skips records whose status did not actually change — most writes to the table
 * only touch taskToken/revokeComment/timestamps — and records with no NewImage
 * (REMOVE events). Records arrive in order within a shard, so keying a Map by
 * requestId keeps the newest status when a request changes twice in one batch.
 *
 * @example
 *   collectStatusChanges(event.Records) // → [{ requestId: "r1", status: "EXPIRED", updatedAt: "..." }]
 */
export function collectStatusChanges(
  records: DynamoDBRecord[]
): AccessRequestStatusChange[] {
  const changesByRequestId = new Map<string, AccessRequestStatusChange>();
  for (const record of records) {
    const newImage = record.dynamodb?.NewImage;
    const requestId = newImage?.id?.S;
    const status = newImage?.status?.S;
    if (!requestId || !status) continue;
    if (record.dynamodb?.OldImage?.status?.S === status) continue;
    changesByRequestId.set(requestId, {
      requestId,
      status,
      updatedAt: newImage?.updatedAt?.S ?? "",
    });
  }
  return [...changesByRequestId.values()];
}

/**
 * Calls the publishAccessRequestStatus mutation with a SigV4-signed request.
 * AppSync runs with enableIamAuthorizationMode, so this Lambda's execution role
 * is authorized by its appsync:GraphQL IAM grant rather than by an @auth rule.
 */
async function callPublishMutation(
  change: AccessRequestStatusChange
): Promise<void> {
  const url = new URL(GRAPHQL_URL);
  const body = JSON.stringify({
    query: PUBLISH_MUTATION,
    variables: change,
  });

  const signer = new SignatureV4({
    service: "appsync",
    region: REGION,
    sha256: Sha256,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  });

  const signed = await signer.sign(
    new HttpRequest({
      method: "POST",
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname,
      headers: { "Content-Type": "application/json", host: url.hostname },
      body,
    })
  );

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: signed.headers,
    body,
  });
  const result = (await response.json()) as { errors?: unknown[] };
  if (!response.ok || result.errors?.length) {
    throw new Error(
      `publishAccessRequestStatus failed (${response.status}): ${JSON.stringify(result)}`
    );
  }
}

/**
 * DynamoDB stream consumer that mirrors AccessRequestTable status transitions
 * onto the AppSync onAccessRequestStatusChanged subscription. This is the only
 * signal that covers status writes made without a Lambda — SetStatusExpired and
 * SetStatusScheduled are Step Functions DynamoDB SDK integrations.
 *
 * Never throws: a failure here would retry the whole batch and stall the shard,
 * and the UI always reconciles on mount and on Refresh anyway.
 */
export const handler: DynamoDBStreamHandler = async (event) => {
  for (const change of collectStatusChanges(event.Records)) {
    try {
      await callPublishMutation(change);
    } catch (err) {
      console.error(
        JSON.stringify({
          message: "Status change publish failed",
          requestId: change.requestId,
          status: change.status,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
};

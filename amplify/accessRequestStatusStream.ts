import { Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  EventSourceMapping,
  FilterCriteria,
  FilterRule,
  Function as LambdaFunction,
  IFunction,
  StartingPosition,
} from "aws-cdk-lib/aws-lambda";

interface AccessRequestStatusStreamParams {
  publishRequestStatusChangeFn: IFunction;
  accessRequestTableStreamArn: string;
  graphqlApiArn: string;
  graphqlUrl: string;
}

/**
 * Wires the AccessRequestTable DynamoDB stream to publishRequestStatusChange,
 * which republishes status transitions through AppSync so every open page
 * updates without polling.
 *
 * The consumer lives in the data stack (see its defineFunction comment): it
 * needs the stream ARN from AccessRequestWorkflow and the GraphQL endpoint from
 * data, so both references point data → AccessRequestWorkflow, never back.
 */
export function setupAccessRequestStatusStream({
  publishRequestStatusChangeFn,
  accessRequestTableStreamArn,
  graphqlApiArn,
  graphqlUrl,
}: AccessRequestStatusStreamParams): void {
  const publishFn = publishRequestStatusChangeFn as LambdaFunction;

  publishFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
      ],
      resources: [accessRequestTableStreamArn],
    })
  );

  // dynamodb:ListStreams does not support resource-level restrictions.
  publishFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["dynamodb:ListStreams"],
      resources: ["*"],
    })
  );

  // Scoped to the single publish field — narrower than the types/Mutation/*
  // grant Amplify generates for schema-level function access. AppSync always
  // runs with enableIamAuthorizationMode, so this grant is what authorizes the
  // call; @auth rules do not apply to IAM principals.
  publishFn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["appsync:GraphQL"],
      resources: [
        `${graphqlApiArn}/types/Mutation/fields/publishAccessRequestStatus`,
      ],
    })
  );

  publishFn.addEnvironment("APPSYNC_GRAPHQL_URL", graphqlUrl);

  new EventSourceMapping(publishFn, "AccessRequestStatusStreamMapping", {
    target: publishFn,
    eventSourceArn: accessRequestTableStreamArn,
    startingPosition: StartingPosition.LATEST,
    batchSize: 10,
    // Trades up to a second of latency for far fewer invocations.
    maxBatchingWindow: Duration.seconds(1),
    // The handler swallows its own errors, so a batch never poison-pills the
    // shard; one retry only covers a transient AppSync 5xx.
    retryAttempts: 1,
    // A status only ever changes on MODIFY. Creation is already broadcast by
    // the requestAccess mutation through onAccessRequestCreated.
    filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual("MODIFY") })],
  });
}

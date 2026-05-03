import {
  CognitoIdentityProviderClient,
  ListGroupsCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const USER_POOL_ID = process.env.AUTH_USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region: REGION });

export const handler = async () => {
  const groups: Array<{ groupName: string; description: string }> = [];
  let nextToken: string | undefined;

  do {
    const result = await cognito.send(
      new ListGroupsCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        NextToken: nextToken,
      })
    );

    for (const group of result.Groups ?? []) {
      groups.push({
        groupName: group.GroupName ?? "",
        description: group.Description ?? "",
      });
    }

    nextToken = result.NextToken;
  } while (nextToken);

  return groups;
};

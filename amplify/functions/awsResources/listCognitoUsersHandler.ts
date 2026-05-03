import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const USER_POOL_ID = process.env.AUTH_USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region: REGION });

export const handler = async () => {
  const users: Array<{
    username: string;
    email: string;
    displayName: string;
  }> = [];

  let paginationToken: string | undefined;

  do {
    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const user of result.Users ?? []) {
      const attrs = user.Attributes ?? [];
      const email = attrs.find((a) => a.Name === "email")?.Value ?? "";
      const displayName =
        attrs.find((a) => a.Name === "name")?.Value ?? email ?? user.Username ?? "";

      users.push({
        username: user.Username ?? "",
        email,
        displayName,
      });
    }

    paginationToken = result.PaginationToken;
  } while (paginationToken);

  return users;
};

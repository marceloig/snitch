import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getMyIDCUser } from "./helpers";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const USER_POOL_ID = process.env.AUTH_USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region: REGION });

type AppSyncIdentityCognito = {
  username: string;
  claims: Record<string, unknown>;
};

type AppSyncEvent = {
  identity: AppSyncIdentityCognito;
};

/**
 * AppSync resolver: looks up the Cognito user by sub (always present in both
 * access and ID tokens), retrieves their email attribute via AdminGetUser,
 * then finds the matching IDC user by email.
 *
 * We use AdminGetUser instead of reading claims directly because AppSync may
 * forward either the access token or the ID token depending on client config,
 * and only the ID token carries the email claim. The sub is stable across both.
 *
 * Example AppSync call: query { getMyIDCUser { id userName displayName email } }
 */
export const handler = async (event: AppSyncEvent) => {
  // sub is present in both access token and ID token claims
  const sub =
    (event.identity.claims["sub"] as string | undefined) ??
    event.identity.username;

  if (!sub) {
    throw new Error(
      `No sub found in identity. claims=${JSON.stringify(event.identity.claims)}`
    );
  }

  // Retrieve the Cognito user record to get the email attribute.
  // AdminGetUser accepts the sub UUID as the Username parameter.
  const cognitoUser = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: sub })
  );

  const emailAttr = cognitoUser.UserAttributes?.find(
    (a: { Name?: string; Value?: string }) => a.Name === "email"
  );
  const email = emailAttr?.Value;

  if (!email) {
    throw new Error(
      `Cognito user ${sub} has no email attribute. UserAttributes=${JSON.stringify(cognitoUser.UserAttributes)}`
    );
  }

  const match = await getMyIDCUser(email);

  console.log(JSON.stringify({
    msg: "getMyIDCUser result",
    sub,
    email,
    matched: match !== null,
    matchedId: match?.id ?? null,
  }));

  return match;
};

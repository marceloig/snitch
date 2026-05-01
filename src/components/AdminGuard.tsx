import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";

type Props = { children: React.ReactNode };

export function AdminGuard({ children }: Props) {
  const [status, setStatus] = useState<"loading" | "allowed" | "denied">("loading");

  useEffect(() => {
    fetchAuthSession().then((session) => {
      const groups =
        (session.tokens?.idToken?.payload["cognito:groups"] as string[]) ?? [];
      setStatus(groups.includes("Admins") ? "allowed" : "denied");
    });
  }, []);

  if (status === "loading") {
    return (
      <Box padding="l" textAlign="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (status === "denied") {
    return (
      <Alert type="error" header="Access denied">
        Only users in the <strong>Admins</strong> Cognito group can access this
        page.
      </Alert>
    );
  }

  return <>{children}</>;
}

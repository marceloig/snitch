import { useAuthenticator } from "@aws-amplify/ui-react";
import { Route, Routes } from "react-router-dom";

import AppLayout from "@cloudscape-design/components/app-layout";
import TopNavigation from "@cloudscape-design/components/top-navigation";

import { AdminGuard } from "./components/AdminGuard";
import { PrivilegedPoliciesPage } from "./pages/PrivilegedPoliciesPage";

function App() {
  const { user, signOut } = useAuthenticator();

  return (
    <>
      <TopNavigation
        identity={{ href: "#", title: "Snitch" }}
        utilities={[
          {
            type: "button",
            text: user?.signInDetails?.loginId ?? "User",
            iconName: "user-profile",
          },
          {
            type: "button",
            text: "Sign out",
            onClick: signOut,
          },
        ]}
      />
      <AppLayout
        navigationHide
        toolsHide
        content={
          <Routes>
            <Route
              path="/"
              element={
                <AdminGuard>
                  <PrivilegedPoliciesPage />
                </AdminGuard>
              }
            />
          </Routes>
        }
      />
    </>
  );
}

export default App;

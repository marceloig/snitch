import { useState, useEffect, useCallback } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { SelectProps } from "@cloudscape-design/components/select";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";

const client = generateClient<Schema>();

// Placeholder type — replace once the AccessRequest backend model is defined
type AccessRequest = {
  id: string;
  accountId: string;
  permissionSetArn: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  createdAt: string;
};

type PermittedAccess = NonNullable<
  Awaited<ReturnType<typeof client.queries.evaluateMyAccess>>["data"]
>[number];

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; idcUserId: string; permitted: NonNullable<PermittedAccess>[] };

type FormValues = {
  account: SelectProps.Option | null;
  permissionSet: SelectProps.Option | null;
};

const EMPTY_FORM: FormValues = { account: null, permissionSet: null };

export function RequestAccessPage() {
  const [requests] = useState<AccessRequest[]>([]);
  const [selectedItems, setSelectedItems] = useState<AccessRequest[]>([]);

  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [modalOpen, setModalOpen] = useState(false);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  const [accountError, setAccountError] = useState("");
  const [permissionSetError, setPermissionSetError] = useState("");

  // Step 1: resolve the logged-in user's Cognito email, then find their IDC
  // identity and evaluate what they're permitted to access via AVP.
  const loadPermittedAccess = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      // Resolve IDC user — the Lambda matches by email using the Cognito username
      const idcRes = await client.queries.getMyIDCUser();
      if (idcRes.errors?.length) {
        throw new Error(idcRes.errors.map((e) => e.message).join("; "));
      }
      if (!idcRes.data) {
        throw new Error(
          "No IAM Identity Center user found matching your account. " +
            "Contact your administrator to ensure your IDC account is set up."
        );
      }

      const idcUserId = idcRes.data.id;
      if (!idcUserId) throw new Error("IDC user record is missing an ID");

      // Evaluate permitted (account, permissionSet) pairs via AVP
      const evalRes = await client.queries.evaluateMyAccess({ idcUserId });
      if (evalRes.errors?.length) {
        throw new Error(evalRes.errors.map((e) => e.message).join("; "));
      }

      const permitted = (evalRes.data ?? []).filter(
        (p): p is NonNullable<PermittedAccess> => p !== null
      );

      setLoadState({ status: "ready", idcUserId, permitted });
    } catch (err) {
      setLoadState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load access options",
      });
    }
  }, []);

  useEffect(() => {
    loadPermittedAccess();
  }, [loadPermittedAccess]);

  function openModal() {
    setFormValues(EMPTY_FORM);
    setAccountError("");
    setPermissionSetError("");
    setModalOpen(true);
  }

  // Derive unique account options from the permitted pairs
  function accountOptions(): SelectProps.Option[] {
    if (loadState.status !== "ready") return [];
    const seen = new Set<string>();
    return loadState.permitted
      .filter((p) => {
        if (seen.has(p.accountId ?? "")) return false;
        seen.add(p.accountId ?? "");
        return true;
      })
      .map((p) => ({ label: p.accountId ?? "", value: p.accountId ?? "" }));
  }

  // Derive permission set options filtered to the selected account
  function permissionSetOptions(): SelectProps.Option[] {
    if (loadState.status !== "ready" || !formValues.account) return [];
    return loadState.permitted
      .filter((p) => p.accountId === formValues.account!.value)
      .map((p) => ({
        label: p.permissionSetName ?? p.permissionSetArn ?? "",
        value: p.permissionSetArn ?? "",
      }));
  }

  function validate(): boolean {
    let valid = true;
    if (!formValues.account) {
      setAccountError("Select an account.");
      valid = false;
    } else {
      setAccountError("");
    }
    if (!formValues.permissionSet) {
      setPermissionSetError("Select a permission set.");
      valid = false;
    } else {
      setPermissionSetError("");
    }
    return valid;
  }

  function handleSubmit() {
    if (!validate()) return;
    // TODO: wire up backend mutation once AccessRequest model is defined
    setModalOpen(false);
  }

  const isLoading = loadState.status === "loading" || loadState.status === "idle";

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description="Request temporary access to an AWS account using a specific Permission Set"
          >
            Request Access
          </Header>
        }
      >
        {loadState.status === "error" && (
          <Box margin={{ bottom: "m" }}>
            <Alert
              type="error"
              header="Could not load access options"
              action={
                <Button onClick={loadPermittedAccess}>Retry</Button>
              }
            >
              {loadState.message}
            </Alert>
          </Box>
        )}

        <Table
          selectionType="single"
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
          columnDefinitions={[
            {
              id: "accountId",
              header: "Account",
              cell: (item) => item.accountId,
            },
            {
              id: "permissionSetArn",
              header: "Permission Set",
              cell: (item) => item.permissionSetArn,
            },
            {
              id: "status",
              header: "Status",
              cell: (item) => item.status,
              width: 110,
            },
            {
              id: "createdAt",
              header: "Requested at",
              cell: (item) => item.createdAt,
            },
          ]}
          items={requests}
          loading={false}
          loadingText="Loading requests..."
          empty={
            <Box textAlign="center" color="inherit">
              <b>No requests</b>
              <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                Submit a new request to get started.
              </Box>
            </Box>
          }
          header={
            <Header
              variant="h2"
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button disabled={selectedItems.length === 0}>Cancel request</Button>
                  <Button
                    variant="primary"
                    onClick={openModal}
                    disabled={isLoading || loadState.status === "error"}
                    loading={isLoading}
                  >
                    New request
                  </Button>
                </SpaceBetween>
              }
            >
              My requests
            </Header>
          }
        />
      </ContentLayout>

      <Modal
        visible={modalOpen}
        onDismiss={() => setModalOpen(false)}
        header="New access request"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSubmit}>
                Submit request
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        {loadState.status !== "ready" ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
          </Box>
        ) : loadState.permitted.length === 0 ? (
          <Alert type="info" header="No access available">
            There are no policies that grant you access to any AWS account. Contact
            your administrator.
          </Alert>
        ) : (
          <Form>
            <SpaceBetween size="l">
              <FormField
                label="AWS Account"
                description="The account you want to access."
                errorText={accountError}
              >
                <Select
                  selectedOption={formValues.account}
                  onChange={({ detail }) =>
                    setFormValues({
                      account: detail.selectedOption,
                      // Reset permission set when account changes
                      permissionSet: null,
                    })
                  }
                  options={accountOptions()}
                  filteringType="auto"
                  placeholder="Select an account"
                  empty="No accounts available"
                />
              </FormField>

              <FormField
                label="Permission Set"
                description="The role you will assume in the selected account."
                errorText={permissionSetError}
              >
                <Select
                  selectedOption={formValues.permissionSet}
                  onChange={({ detail }) =>
                    setFormValues((prev) => ({
                      ...prev,
                      permissionSet: detail.selectedOption,
                    }))
                  }
                  options={permissionSetOptions()}
                  filteringType="auto"
                  placeholder={
                    formValues.account
                      ? "Select a permission set"
                      : "Select an account first"
                  }
                  disabled={!formValues.account}
                  empty="No permission sets available for this account"
                />
              </FormField>
            </SpaceBetween>
          </Form>
        )}
      </Modal>
    </>
  );
}

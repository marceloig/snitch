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
import TimeInput from "@cloudscape-design/components/time-input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";

const client = generateClient<Schema>();

type AccessRequest = NonNullable<
  Awaited<ReturnType<typeof client.queries.listMyAccessRequests>>["data"]
>[number];

// Narrowed view used in the table — all display fields are guaranteed strings
type AccessRequestRow = {
  id: string;
  idcUserId: string;
  accountId: string;
  permissionSetArn: string;
  permissionSetName: string;
  durationMinutes: number;
  status: string;
  stepFunctionExecutionArn: string | null;
  createdAt: string;
  updatedAt: string;
};

function toRow(item: NonNullable<AccessRequest>): AccessRequestRow {
  return {
    id: item.id ?? "",
    idcUserId: item.idcUserId ?? "",
    accountId: item.accountId ?? "",
    permissionSetArn: item.permissionSetArn ?? "",
    permissionSetName: item.permissionSetName ?? "",
    durationMinutes: item.durationMinutes ?? 0,
    status: item.status ?? "PENDING",
    stepFunctionExecutionArn: item.stepFunctionExecutionArn ?? null,
    createdAt: item.createdAt ?? "",
    updatedAt: item.updatedAt ?? "",
  };
}

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
  durationMinutes: string;
};

type FormErrors = {
  account: string;
  permissionSet: string;
  durationMinutes: string;
};

const EMPTY_FORM: FormValues = { account: null, permissionSet: null, durationMinutes: "" };
const EMPTY_ERRORS: FormErrors = { account: "", permissionSet: "", durationMinutes: "" };

function requestStatusType(
  status: string | null | undefined
): "success" | "pending" | "stopped" | "error" {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "EXPIRED":
      return "stopped";
    case "FAILED":
      return "error";
    default:
      return "pending";
  }
}

export function RequestAccessPage() {
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [selectedItems, setSelectedItems] = useState<AccessRequestRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [modalOpen, setModalOpen] = useState(false);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>(EMPTY_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Step 1: resolve the logged-in user's Cognito email, then find their IDC
  // identity and evaluate what they're permitted to access via AVP.
  const loadPermittedAccess = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
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

  const loadRequests = useCallback(async () => {
    if (loadState.status !== "ready") return;
    setRequestsLoading(true);
    try {
      const res = await client.queries.listMyAccessRequests({
        idcUserId: loadState.idcUserId,
      });
      setRequests(
        (res.data ?? []).filter((r): r is NonNullable<typeof r> => r !== null).map(toRow)
      );
    } finally {
      setRequestsLoading(false);
    }
  }, [loadState]);

  useEffect(() => {
    loadPermittedAccess();
  }, [loadPermittedAccess]);

  // Load requests once the IDC user ID is known (needed for the GSI query)
  useEffect(() => {
    if (loadState.status === "ready") {
      loadRequests();
    }
  }, [loadState.status, loadRequests]);

  function openModal() {
    setFormValues(EMPTY_FORM);
    setFormErrors(EMPTY_ERRORS);
    setSubmitError("");
    setModalOpen(true);
  }

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
    const errors: FormErrors = { account: "", permissionSet: "", durationMinutes: "" };
    let valid = true;

    if (!formValues.account) {
      errors.account = "Select an account.";
      valid = false;
    }
    if (!formValues.permissionSet) {
      errors.permissionSet = "Select a permission set.";
      valid = false;
    }

    const [hStr, mStr] = formValues.durationMinutes.split(":");
    const hours = Number(hStr);
    const mins = Number(mStr);
    if (
      !/^\d{2}:\d{2}$/.test(formValues.durationMinutes) ||
      (hours === 0 && mins === 0)
    ) {
      errors.durationMinutes = "Enter a duration greater than 0 (hh:mm).";
      valid = false;
    } else if (loadState.status === "ready" && formValues.account && formValues.permissionSet) {
      const permittedEntry = loadState.permitted.find(
        (p) =>
          p.accountId === formValues.account!.value &&
          p.permissionSetArn === formValues.permissionSet!.value
      );
      const requestedMinutes = hours * 60 + mins;
      if (
        permittedEntry?.maxDurationMinutes != null &&
        requestedMinutes > permittedEntry.maxDurationMinutes
      ) {
        const maxH = Math.floor(permittedEntry.maxDurationMinutes / 60);
        const maxM = permittedEntry.maxDurationMinutes % 60;
        const maxLabel = `${String(maxH).padStart(2, "0")}:${String(maxM).padStart(2, "0")}`;
        errors.durationMinutes = `Duration exceeds the policy limit of ${maxLabel} (hh:mm).`;
        valid = false;
      }
    }

    setFormErrors(errors);
    return valid;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (loadState.status !== "ready") return;

    setSubmitting(true);
    setSubmitError("");

    try {
      const permittedEntry = loadState.permitted.find(
        (p) =>
          p.accountId === formValues.account!.value &&
          p.permissionSetArn === formValues.permissionSet!.value
      );

      const res = await client.mutations.requestAccess({
        idcUserId: loadState.idcUserId,
        accountId: formValues.account!.value ?? "",
        permissionSetArn: formValues.permissionSet!.value ?? "",
        permissionSetName:
          permittedEntry?.permissionSetName ?? formValues.permissionSet!.label ?? "",
        durationMinutes: (() => {
          const [h, m] = formValues.durationMinutes.split(":").map(Number);
          return h * 60 + m;
        })(),
      });

      if (res.errors?.length) {
        throw new Error(res.errors.map((e) => e.message).join("; "));
      }

      setModalOpen(false);
      // Refresh the requests table to show the new entry
      await loadRequests();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to submit request. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
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
              action={<Button onClick={loadPermittedAccess}>Retry</Button>}
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
              id: "permissionSetName",
              header: "Permission Set",
              cell: (item) => item.permissionSetName,
            },
            {
              id: "durationMinutes",
              header: "Duration (min)",
              cell: (item) => item.durationMinutes,
              width: 120,
            },
            {
              id: "status",
              header: "Status",
              cell: (item) => (
                <StatusIndicator type={requestStatusType(item.status)}>
                  {item.status ?? "PENDING"}
                </StatusIndicator>
              ),
              width: 130,
            },
            {
              id: "createdAt",
              header: "Requested at",
              cell: (item) => item.createdAt ?? "",
            },
          ]}
          items={requests}
          loading={requestsLoading}
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
              <Button variant="link" onClick={() => setModalOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSubmit} loading={submitting}>
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
            There are no policies that grant you access to any AWS account. Contact your
            administrator.
          </Alert>
        ) : (
          <Form errorText={submitError}>
            <SpaceBetween size="l">
              <FormField
                label="AWS Account"
                description="The account you want to access."
                errorText={formErrors.account}
              >
                <Select
                  selectedOption={formValues.account}
                  onChange={({ detail }) =>
                    setFormValues({
                      account: detail.selectedOption,
                      // Reset permission set when account changes
                      permissionSet: null,
                      durationMinutes: formValues.durationMinutes,
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
                errorText={formErrors.permissionSet}
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
                    formValues.account ? "Select a permission set" : "Select an account first"
                  }
                  disabled={!formValues.account}
                  empty="No permission sets available for this account"
                />
              </FormField>

              <FormField
                label="Duration"
                description="How long you need access, in hours and minutes."
                errorText={formErrors.durationMinutes}
              >
                <TimeInput
                  format="hh:mm"
                  placeholder="hh:mm"
                  use24Hour={true}
                  value={formValues.durationMinutes}
                  onChange={({ detail }) =>
                    setFormValues((prev) => ({ ...prev, durationMinutes: detail.value }))
                  }
                />
              </FormField>
            </SpaceBetween>
          </Form>
        )}
      </Modal>
    </>
  );
}

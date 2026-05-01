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
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";

const client = generateClient<Schema>();

type Policy = Schema["PrivilegedPolicy"]["type"];
type Option = SelectProps.Option;

const PRINCIPAL_TYPE_OPTIONS: Option[] = [
  { label: "User", value: "USER" },
  { label: "Group", value: "GROUP" },
];

type FormValues = {
  name: string;
  description: string;
  principalType: Option;
  principal: Option | null;
  accounts: readonly Option[];
  ous: readonly Option[];
  permissionSets: readonly Option[];
};

const EMPTY_FORM: FormValues = {
  name: "",
  description: "",
  principalType: PRINCIPAL_TYPE_OPTIONS[0],
  principal: null,
  accounts: [],
  ous: [],
  permissionSets: [],
};

type AWSResources = {
  users: Option[];
  groups: Option[];
  accounts: Option[];
  ous: Option[];
  permissionSets: Option[];
};

const EMPTY_RESOURCES: AWSResources = {
  users: [],
  groups: [],
  accounts: [],
  ous: [],
  permissionSets: [],
};

export function PrivilegedPoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Policy[]>([]);

  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");
  const [principalError, setPrincipalError] = useState("");
  const [permissionSetError, setPermissionSetError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [awsResources, setAwsResources] = useState<AWSResources>(EMPTY_RESOURCES);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  const fetchPolicies = useCallback(async () => {
    setLoadingPolicies(true);
    const { data } = await client.models.PrivilegedPolicy.list({});
    setPolicies(data);
    setLoadingPolicies(false);
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const loadAWSResources = useCallback(async () => {
    setLoadingResources(true);
    setResourcesError(null);
    try {
      const [usersRes, groupsRes, accountsRes, ousRes, psRes] = await Promise.all([
        client.queries.listIDCUsers(),
        client.queries.listIDCGroups(),
        client.queries.listAWSAccounts(),
        client.queries.listOUs(),
        client.queries.listPermissionSets(),
      ]);

      // GraphQL errors surface as data=null without throwing — treat them as failures
      const graphqlErrors = [usersRes, groupsRes, accountsRes, ousRes, psRes].flatMap(
        (r) => r.errors ?? []
      );
      if (graphqlErrors.length > 0) {
        console.error("AWS resource query errors:", graphqlErrors);
        setResourcesError(
          "Failed to load AWS resources. The backend may not be deployed yet — run `npm run sandbox`. " +
            graphqlErrors.map((e) => e.message).join("; ")
        );
        return;
      }

      // Null data (no GraphQL error) means resolver returned nothing — likely not deployed
      const hasNullData = [usersRes, groupsRes, accountsRes, ousRes, psRes].some(
        (r) => r.data === null
      );
      if (hasNullData) {
        setResourcesError(
          "AWS resources returned no data. Make sure the backend is deployed: run `npm run sandbox`."
        );
        return;
      }

      setAwsResources({
        users: (usersRes.data ?? []).map((u) => ({
          label: u?.displayName ?? u?.userName ?? "",
          value: u?.id ?? "",
          description: u?.email ?? undefined,
        })),
        groups: (groupsRes.data ?? []).map((g) => ({
          label: g?.displayName ?? "",
          value: g?.id ?? "",
          description: g?.description ?? undefined,
        })),
        accounts: (accountsRes.data ?? []).map((a) => ({
          label: `${a?.name} (${a?.id})`,
          value: a?.id ?? "",
          description: a?.email ?? undefined,
        })),
        ous: (ousRes.data ?? []).map((ou) => ({
          label: ou?.name ?? "",
          value: ou?.id ?? "",
          description: ou?.arn ?? undefined,
        })),
        permissionSets: (psRes.data ?? []).map((ps) => ({
          label: ps?.name ?? "",
          value: ps?.arn ?? "",
          description: ps?.description ?? undefined,
        })),
      });
    } catch (err) {
      console.error("AWS resource load error:", err);
      setResourcesError(
        "Failed to load AWS resources. Check Lambda permissions and CloudWatch logs."
      );
    } finally {
      setLoadingResources(false);
    }
  }, []);

  function clearFormErrors() {
    setFormError(null);
    setNameError("");
    setPrincipalError("");
    setPermissionSetError("");
  }

  function openCreateModal() {
    setFormValues(EMPTY_FORM);
    clearFormErrors();
    setModalMode("create");
    loadAWSResources();
  }

  function openEditModal() {
    const policy = selectedItems[0];
    if (!policy) return;

    const principalType =
      PRINCIPAL_TYPE_OPTIONS.find((o) => o.value === policy.principalType) ??
      PRINCIPAL_TYPE_OPTIONS[0];

    setFormValues({
      name: policy.name,
      description: policy.description ?? "",
      principalType,
      principal: policy.principalId
        ? {
            label: policy.principalDisplayName ?? policy.principalId,
            value: policy.principalId,
          }
        : null,
      accounts: (policy.accountIds ?? []).map((id) => ({ label: id ?? "", value: id ?? "" })),
      ous: (policy.ouIds ?? []).map((id) => ({ label: id ?? "", value: id ?? "" })),
      permissionSets: (policy.permissionSetArns ?? []).map((arn, i) => ({
        label: policy.permissionSetNames?.[i] ?? arn ?? "",
        value: arn ?? "",
      })),
    });

    clearFormErrors();
    setModalMode("edit");
    loadAWSResources();
  }

  function validate(): boolean {
    let valid = true;
    if (!formValues.name.trim()) {
      setNameError("Name is required.");
      valid = false;
    } else {
      setNameError("");
    }
    if (!formValues.principal) {
      setPrincipalError("A user or group is required.");
      valid = false;
    } else {
      setPrincipalError("");
    }
    if (formValues.permissionSets.length === 0) {
      setPermissionSetError("At least one permission set is required.");
      valid = false;
    } else {
      setPermissionSetError("");
    }
    return valid;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: formValues.name.trim(),
        description: formValues.description.trim() || undefined,
        principalType: formValues.principalType.value as "USER" | "GROUP",
        principalId: formValues.principal!.value ?? "",
        principalDisplayName: formValues.principal!.label ?? "",
        accountIds: formValues.accounts.map((o) => o.value ?? ""),
        ouIds: formValues.ous.map((o) => o.value ?? ""),
        permissionSetArns: formValues.permissionSets.map((o) => o.value ?? ""),
        permissionSetNames: formValues.permissionSets.map((o) => o.label ?? ""),
      };

      if (modalMode === "create") {
        await client.mutations.createPrivilegedPolicyWithAVP(payload);
      } else {
        await client.mutations.updatePrivilegedPolicyWithAVP({
          id: selectedItems[0].id,
          ...payload,
        });
      }

      setModalMode(null);
      setSelectedItems([]);
      await fetchPolicies();
    } catch {
      setFormError("Failed to save policy. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const policy = selectedItems[0];
    if (!policy) return;
    setDeleting(true);
    try {
      await client.mutations.deletePrivilegedPolicyWithAVP({ id: policy.id });
      setSelectedItems([]);
      await fetchPolicies();
    } finally {
      setDeleting(false);
    }
  }

  const principalOptions =
    formValues.principalType.value === "GROUP"
      ? awsResources.groups
      : awsResources.users;

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description="Define which IAM Identity Center users or groups can access AWS accounts with specific Permission Sets"
          >
            Privileged Policies
          </Header>
        }
      >
        <Table
          selectionType="single"
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
          columnDefinitions={[
            {
              id: "name",
              header: "Name",
              cell: (item) => item.name,
              sortingField: "name",
            },
            {
              id: "principalType",
              header: "Type",
              cell: (item) => item.principalType ?? "-",
              width: 90,
            },
            {
              id: "principal",
              header: "User / Group",
              cell: (item) => item.principalDisplayName ?? item.principalId,
            },
            {
              id: "accounts",
              header: "Accounts",
              cell: (item) => {
                const n = item.accountIds?.length ?? 0;
                return n > 0 ? `${n} account${n > 1 ? "s" : ""}` : "-";
              },
              width: 110,
            },
            {
              id: "ous",
              header: "OUs",
              cell: (item) => {
                const n = item.ouIds?.length ?? 0;
                return n > 0 ? `${n} OU${n > 1 ? "s" : ""}` : "-";
              },
              width: 90,
            },
            {
              id: "permissionSets",
              header: "Permission Sets",
              cell: (item) =>
                item.permissionSetNames?.filter(Boolean).join(", ") || "-",
            },
          ]}
          items={policies}
          loading={loadingPolicies}
          loadingText="Loading policies..."
          empty={
            <Box textAlign="center" color="inherit">
              <b>No policies</b>
              <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                Create your first privileged policy to get started.
              </Box>
            </Box>
          }
          header={
            <Header
              variant="h2"
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    disabled={selectedItems.length === 0}
                    loading={deleting}
                    onClick={handleDelete}
                  >
                    Delete
                  </Button>
                  <Button
                    disabled={selectedItems.length === 0}
                    onClick={openEditModal}
                  >
                    Edit
                  </Button>
                  <Button variant="primary" onClick={openCreateModal}>
                    Create policy
                  </Button>
                </SpaceBetween>
              }
            >
              Policies
            </Header>
          }
        />
      </ContentLayout>

      <Modal
        visible={modalMode !== null}
        onDismiss={() => setModalMode(null)}
        header={modalMode === "create" ? "Create policy" : "Edit policy"}
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setModalMode(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={submitting}
                onClick={handleSubmit}
                disabled={loadingResources}
              >
                {modalMode === "create" ? "Create" : "Save changes"}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        {loadingResources ? (
          <Box textAlign="center" padding="l">
            <Spinner size="large" />
            <Box variant="p" padding={{ top: "s" }}>
              Loading AWS resources…
            </Box>
          </Box>
        ) : (
          <SpaceBetween size="m">
            {resourcesError && <Alert type="error">{resourcesError}</Alert>}
            <Form errorText={formError ?? undefined}>
              <SpaceBetween size="l">
                <FormField label="Name" errorText={nameError}>
                  <Input
                    value={formValues.name}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({ ...prev, name: detail.value }))
                    }
                    placeholder="Enter policy name"
                  />
                </FormField>

                <FormField label="Description — optional">
                  <Input
                    value={formValues.description}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({ ...prev, description: detail.value }))
                    }
                    placeholder="Enter a short description"
                  />
                </FormField>

                <FormField label="Principal type">
                  <Select
                    selectedOption={formValues.principalType}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({
                        ...prev,
                        principalType: detail.selectedOption,
                        principal: null,
                      }))
                    }
                    options={PRINCIPAL_TYPE_OPTIONS}
                  />
                </FormField>

                <FormField label="User or Group" errorText={principalError}>
                  <Select
                    selectedOption={formValues.principal}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({
                        ...prev,
                        principal: detail.selectedOption,
                      }))
                    }
                    options={principalOptions}
                    filteringType="auto"
                    placeholder={`Select a ${formValues.principalType.value === "GROUP" ? "group" : "user"}`}
                    empty="No results found"
                  />
                </FormField>

                <FormField
                  label="Accounts"
                  description="Users will have access to all selected accounts."
                >
                  <Multiselect
                    selectedOptions={formValues.accounts}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({
                        ...prev,
                        accounts: detail.selectedOptions,
                      }))
                    }
                    options={awsResources.accounts}
                    filteringType="auto"
                    placeholder="Select accounts"
                    empty="No accounts found"
                  />
                </FormField>

                <FormField
                  label="Organization Units (OUs)"
                  description="Users will have access to all accounts within the selected OUs."
                >
                  <Multiselect
                    selectedOptions={formValues.ous}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({
                        ...prev,
                        ous: detail.selectedOptions,
                      }))
                    }
                    options={awsResources.ous}
                    filteringType="auto"
                    placeholder="Select OUs"
                    empty="No OUs found"
                  />
                </FormField>

                <FormField label="Permission Sets" errorText={permissionSetError}>
                  <Multiselect
                    selectedOptions={formValues.permissionSets}
                    onChange={({ detail }) =>
                      setFormValues((prev) => ({
                        ...prev,
                        permissionSets: detail.selectedOptions,
                      }))
                    }
                    options={awsResources.permissionSets}
                    filteringType="auto"
                    placeholder="Select permission sets"
                    empty="No permission sets found"
                  />
                </FormField>
              </SpaceBetween>
            </Form>
          </SpaceBetween>
        )}
      </Modal>
    </>
  );
}

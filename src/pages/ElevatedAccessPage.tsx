import { useState, useEffect, useCallback } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { SelectProps } from "@cloudscape-design/components/select";
import type { StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextContent from "@cloudscape-design/components/text-content";

const client = generateClient<Schema>();

const PAGE_SIZE = 10;

const ALL_STATUSES = [
  "PENDING",
  "PENDING_APPROVAL",
  "SCHEDULED",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "REJECTED",
  "FAILED",
] as const;

const STATUS_FILTER_OPTIONS: SelectProps.Option[] = [
  { label: "All statuses", value: "" },
  ...ALL_STATUSES.map((s) => ({ label: s, value: s })),
];

function statusIndicatorType(status: string): StatusIndicatorProps.Type {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "REVOKED":
    case "EXPIRED":
      return "stopped";
    case "FAILED":
    case "REJECTED":
      return "error";
    case "PENDING_APPROVAL":
      return "warning";
    case "SCHEDULED":
      return "info";
    default:
      return "pending";
  }
}

type AccessRequestRow = {
  id: string;
  userLabel: string;
  accountId: string;
  permissionSetName: string;
  status: string;
  durationMinutes: number;
  createdAt: string;
};

type RawItem = NonNullable<
  Awaited<ReturnType<typeof client.queries.listAllAccessRequests>>["data"]
>[number];

function toRow(item: NonNullable<RawItem>): AccessRequestRow {
  return {
    id: item.id ?? "",
    userLabel:
      item.idcUserDisplayName ?? item.idcUserEmail ?? item.idcUserId ?? "",
    accountId: item.accountId ?? "",
    permissionSetName: item.permissionSetName ?? "",
    status: item.status ?? "",
    durationMinutes: item.durationMinutes ?? 0,
    createdAt: item.createdAt ?? "",
  };
}

export function ElevatedAccessPage() {
  const [allRequests, setAllRequests] = useState<AccessRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedItems, setSelectedItems] = useState<AccessRequestRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<SelectProps.Option>(
    STATUS_FILTER_OPTIONS[0]
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await client.queries.listAllAccessRequests();
      if (res.errors?.length) {
        throw new Error(res.errors.map((e) => e.message).join("; "));
      }
      setAllRequests(
        (res.data ?? [])
          .filter((r): r is NonNullable<RawItem> => r !== null)
          .map(toRow)
      );
      setCurrentPage(1);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load access requests"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const filteredRequests = statusFilter.value
    ? allRequests.filter((r) => r.status === statusFilter.value)
    : allRequests;

  const visibleRequests = filteredRequests.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  function handleFilterChange(option: SelectProps.Option) {
    setStatusFilter(option);
    setCurrentPage(1);
    setSelectedItems([]);
  }

  async function handleRevoke() {
    const selected = selectedItems[0];
    if (!selected) return;
    setRevoking(true);
    setRevokeError("");
    try {
      const res = await client.mutations.revokeAccess({
        requestId: selected.id,
      });
      if (res.errors?.length) {
        throw new Error(res.errors.map((e) => e.message).join("; "));
      }
      setRevokeModalOpen(false);
      setSelectedItems([]);
      setAllRequests((prev) =>
        prev.map((r) =>
          r.id === selected.id ? { ...r, status: "REVOKED" } : r
        )
      );
    } catch (err) {
      setRevokeError(
        err instanceof Error ? err.message : "Revoke failed. Please try again."
      );
    } finally {
      setRevoking(false);
    }
  }

  const selected = selectedItems[0];
  const canRevoke = selected?.status === "ACTIVE";

  return (
    <ContentLayout header={<Header variant="h1">Elevated Access</Header>}>
      <SpaceBetween size="m">
        {loadError && <Alert type="error">{loadError}</Alert>}

        <Table
          loading={loading}
          loadingText="Loading access requests"
          items={visibleRequests}
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) =>
            setSelectedItems(detail.selectedItems)
          }
          selectionType="single"
          trackBy="id"
          columnDefinitions={[
            {
              id: "user",
              header: "User",
              cell: (r) => r.userLabel,
              sortingField: "userLabel",
            },
            {
              id: "accountId",
              header: "Account ID",
              cell: (r) => r.accountId,
            },
            {
              id: "permissionSet",
              header: "Permission Set",
              cell: (r) => r.permissionSetName,
            },
            {
              id: "status",
              header: "Status",
              cell: (r) => (
                <StatusIndicator type={statusIndicatorType(r.status)}>
                  {r.status}
                </StatusIndicator>
              ),
              width: 180,
            },
            {
              id: "duration",
              header: "Duration (min)",
              cell: (r) => r.durationMinutes,
              width: 140,
            },
            {
              id: "createdAt",
              header: "Requested at",
              cell: (r) => r.createdAt,
            },
          ]}
          header={
            <Header
              variant="h2"
              counter={`(${filteredRequests.length})`}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Select
                    selectedOption={statusFilter}
                    onChange={({ detail }) =>
                      handleFilterChange(detail.selectedOption)
                    }
                    options={STATUS_FILTER_OPTIONS}
                  />
                  <Button
                    iconName="refresh"
                    loading={loading}
                    onClick={loadRequests}
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canRevoke}
                    onClick={() => {
                      setRevokeError("");
                      setRevokeModalOpen(true);
                    }}
                  >
                    Revoke Access
                  </Button>
                </SpaceBetween>
              }
            >
              All Access Requests
            </Header>
          }
          pagination={
            <Pagination
              currentPageIndex={currentPage}
              pagesCount={Math.max(
                1,
                Math.ceil(filteredRequests.length / PAGE_SIZE)
              )}
              onChange={({ detail }) =>
                setCurrentPage(detail.currentPageIndex)
              }
            />
          }
          empty={
            <Box textAlign="center" color="inherit">
              No access requests found
            </Box>
          }
        />

        <Modal
          visible={revokeModalOpen}
          onDismiss={() => setRevokeModalOpen(false)}
          header="Revoke access"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  variant="link"
                  onClick={() => setRevokeModalOpen(false)}
                  disabled={revoking}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={revoking}
                  onClick={handleRevoke}
                >
                  Confirm revocation
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            {revokeError && <Alert type="error">{revokeError}</Alert>}
            {selected && (
              <TextContent>
                <p>
                  This will immediately signal the Step Function to proceed to
                  permission removal for:
                </p>
                <p>
                  <strong>User:</strong> {selected.userLabel}
                  <br />
                  <strong>Account:</strong> {selected.accountId}
                  <br />
                  <strong>Permission Set:</strong> {selected.permissionSetName}
                  <br />
                  <strong>Duration:</strong> {selected.durationMinutes} minutes
                  <br />
                  <strong>Requested at:</strong> {selected.createdAt}
                </p>
                <p>This action cannot be undone.</p>
              </TextContent>
            )}
          </SpaceBetween>
        </Modal>
      </SpaceBetween>
    </ContentLayout>
  );
}

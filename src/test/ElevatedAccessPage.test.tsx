import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockListAllAccessRequests, mockRevokeAccess } = vi.hoisted(() => ({
  mockListAllAccessRequests: vi.fn(),
  mockRevokeAccess: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    queries: { listAllAccessRequests: mockListAllAccessRequests },
    mutations: { revokeAccess: mockRevokeAccess },
  }),
}));

vi.mock("../../amplify_outputs.json", () => ({ default: {} }));

import { ElevatedAccessPage } from "../pages/ElevatedAccessPage";

const ACTIVE_REQUEST = {
  id: "req-1",
  idcUserDisplayName: "Alice",
  idcUserEmail: "alice@example.com",
  idcUserId: "user-1",
  accountId: "111111111111",
  permissionSetName: "ReadOnly",
  permissionSetArn: "arn:aws:sso:::permissionSet/ps-read",
  status: "ACTIVE",
  durationMinutes: 60,
  createdAt: "2024-01-02T10:00:00Z",
  updatedAt: "2024-01-02T10:00:00Z",
};

const EXPIRED_REQUEST = {
  ...ACTIVE_REQUEST,
  id: "req-2",
  idcUserDisplayName: "Bob",
  status: "EXPIRED",
  createdAt: "2024-01-01T10:00:00Z",
};

describe("ElevatedAccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevokeAccess.mockResolvedValue({ data: { ...ACTIVE_REQUEST, status: "REVOKED" }, errors: undefined });
  });

  describe("loading and rendering", () => {
    it("shows a loading indicator while fetching", () => {
      mockListAllAccessRequests.mockReturnValue(new Promise(() => {}));
      render(<ElevatedAccessPage />);
      expect(screen.getByText(/loading access requests/i)).toBeInTheDocument();
    });

    it("renders all requests in the table after load", async () => {
      mockListAllAccessRequests.mockResolvedValue({
        data: [ACTIVE_REQUEST, EXPIRED_REQUEST],
        errors: undefined,
      });
      render(<ElevatedAccessPage />);

      await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    it("shows an error alert when the query fails", async () => {
      mockListAllAccessRequests.mockResolvedValue({
        data: null,
        errors: [{ message: "Unauthorized" }],
      });
      render(<ElevatedAccessPage />);

      await waitFor(() =>
        expect(screen.getByText("Unauthorized")).toBeInTheDocument()
      );
    });
  });

  describe("Revoke Access button", () => {
    beforeEach(() => {
      mockListAllAccessRequests.mockResolvedValue({
        data: [ACTIVE_REQUEST, EXPIRED_REQUEST],
        errors: undefined,
      });
    });

    it("is disabled when no row is selected", async () => {
      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Alice"));
      expect(screen.getByRole("button", { name: /revoke access/i })).toBeDisabled();
    });

    it("is disabled when the selected row is not ACTIVE", async () => {
      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Bob"));

      await userEvent.click(screen.getAllByRole("radio")[1]);
      expect(screen.getByRole("button", { name: /revoke access/i })).toBeDisabled();
    });

    it("is enabled when the selected row is ACTIVE", async () => {
      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Alice"));

      await userEvent.click(screen.getAllByRole("radio")[0]);
      expect(screen.getByRole("button", { name: /revoke access/i })).toBeEnabled();
    });
  });

  describe("revocation flow", () => {
    beforeEach(() => {
      mockListAllAccessRequests.mockResolvedValue({
        data: [ACTIVE_REQUEST],
        errors: undefined,
      });
    });

    it("opens a confirmation modal when Revoke Access is clicked", async () => {
      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Alice"));

      await userEvent.click(screen.getAllByRole("radio")[0]);
      await userEvent.click(screen.getByRole("button", { name: /revoke access/i }));

      expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument();
    });

    it("calls revokeAccess mutation and updates the row to REVOKED on confirm", async () => {
      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Alice"));

      await userEvent.click(screen.getAllByRole("radio")[0]);
      await userEvent.click(screen.getByRole("button", { name: /revoke access/i }));
      await userEvent.click(screen.getByRole("button", { name: /confirm revocation/i }));

      await waitFor(() =>
        expect(mockRevokeAccess).toHaveBeenCalledWith({ requestId: "req-1" })
      );
      await waitFor(() => expect(screen.getByText("REVOKED")).toBeInTheDocument());
    });

    it("shows an error in the modal when the mutation fails", async () => {
      mockRevokeAccess.mockResolvedValue({
        data: null,
        errors: [{ message: "Request is no longer active" }],
      });

      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Alice"));

      await userEvent.click(screen.getAllByRole("radio")[0]);
      await userEvent.click(screen.getByRole("button", { name: /revoke access/i }));
      await userEvent.click(screen.getByRole("button", { name: /confirm revocation/i }));

      await waitFor(() =>
        expect(
          screen.getByText("Request is no longer active")
        ).toBeInTheDocument()
      );
    });
  });

  describe("status filter", () => {
    it("shows all requests when filter is All statuses", async () => {
      mockListAllAccessRequests.mockResolvedValue({
        data: [ACTIVE_REQUEST, EXPIRED_REQUEST],
        errors: undefined,
      });
      render(<ElevatedAccessPage />);
      await waitFor(() => screen.getByText("Alice"));

      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });
});

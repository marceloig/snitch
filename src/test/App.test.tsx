import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";

// Mock aws-amplify/data
vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      Todo: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: null }),
        update: vi.fn().mockResolvedValue({ data: null }),
        delete: vi.fn().mockResolvedValue({ data: null }),
      },
    },
  }),
}));

// Mock @aws-amplify/ui-react
vi.mock("@aws-amplify/ui-react", () => ({
  useAuthenticator: () => ({
    user: { signInDetails: { loginId: "test@example.com" } },
    signOut: vi.fn(),
  }),
  Authenticator: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Mock Cloudscape global styles (CSS import)
vi.mock("@cloudscape-design/global-styles/index.css", () => ({}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the app header", () => {
    render(<App />);
    expect(screen.getByText("My Todos")).toBeInTheDocument();
  });

  it("renders the add todo input", () => {
    render(<App />);
    expect(
      screen.getByPlaceholderText("Enter a new todo...")
    ).toBeInTheDocument();
  });

  it("renders the add button", () => {
    render(<App />);
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("shows empty state when no todos", async () => {
    render(<App />);
    expect(await screen.findByText("No todos")).toBeInTheDocument();
  });

  it("renders the sign out button", () => {
    render(<App />);
    const signOutButtons = screen.getAllByText("Sign out");
    expect(signOutButtons.length).toBeGreaterThan(0);
  });

  it("displays the user email", () => {
    render(<App />);
    const emailElements = screen.getAllByText("test@example.com");
    expect(emailElements.length).toBeGreaterThan(0);
  });
});

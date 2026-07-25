import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { invoke } from "@tauri-apps/api/core";
import { GitIdentitySettings } from "./GitIdentitySettings";

const mockInvoke = vi.mocked(invoke);

const config = {
  effective: { name: "Local Dev", email: "local@example.com" },
  local: { name: "Local Dev", email: "local@example.com" },
  global: { name: "Global Dev", email: "global@example.com" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GitIdentitySettings", () => {
  it("shows the effective identity and prefills the local scope", async () => {
    mockInvoke.mockResolvedValueOnce(config); // get_identity_config
    render(<GitIdentitySettings />);

    // The inputs are prefilled by a passive effect that runs *after* the effect
    // which loads config and renders the effective-identity text — so wait on the
    // input value itself, not the text, or the assertion can race the prefill.
    await waitFor(() =>
      expect(screen.getByLabelText("Identity name")).toHaveValue("Local Dev"),
    );
    expect(screen.getByLabelText("Identity email")).toHaveValue(
      "local@example.com",
    );
    expect(screen.getByText(/Local Dev/)).toBeInTheDocument();
  });

  it("prefills from the global scope when switched", async () => {
    mockInvoke.mockResolvedValueOnce(config);
    render(<GitIdentitySettings />);
    await waitFor(() =>
      expect(screen.getByLabelText("Identity name")).toHaveValue("Local Dev"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Global" }));

    expect(screen.getByLabelText("Identity name")).toHaveValue("Global Dev");
    expect(screen.getByLabelText("Identity email")).toHaveValue(
      "global@example.com",
    );
  });

  it("prefills the selected scope after an identity config reload", async () => {
    const configWithoutGlobal = {
      effective: { name: "Effective Dev", email: "effective@example.com" },
      local: { name: "Local Dev", email: "local@example.com" },
      global: null,
    };
    const refreshedConfig = {
      effective: { name: "Saved Global", email: "saved@example.com" },
      local: { name: "Local Dev", email: "local@example.com" },
      global: { name: "Saved Global", email: "saved@example.com" },
    };
    mockInvoke
      .mockResolvedValueOnce(configWithoutGlobal)
      .mockResolvedValueOnce(refreshedConfig);
    render(<GitIdentitySettings />);
    await waitFor(() =>
      expect(screen.getByLabelText("Identity name")).toHaveValue("Local Dev"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Global" }));
    expect(screen.getByLabelText("Identity name")).toHaveValue("Effective Dev");
    expect(screen.getByLabelText("Identity email")).toHaveValue(
      "effective@example.com",
    );

    fireEvent.change(screen.getByLabelText("Identity name"), {
      target: { value: "Saved Global" },
    });
    fireEvent.change(screen.getByLabelText("Identity email"), {
      target: { value: "saved@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Identity name")).toHaveValue(
        "Saved Global",
      ),
    );
    expect(screen.getByLabelText("Identity email")).toHaveValue(
      "saved@example.com",
    );
  });

  it("saves the chosen scope's identity", async () => {
    mockInvoke.mockResolvedValueOnce(config); // get_identity_config
    mockInvoke.mockResolvedValueOnce({
      ...config,
      local: { name: "Edited", email: "edited@example.com" },
    }); // set_identity
    render(<GitIdentitySettings />);
    await waitFor(() =>
      expect(screen.getByLabelText("Identity name")).toHaveValue("Local Dev"),
    );

    fireEvent.change(screen.getByLabelText("Identity name"), {
      target: { value: "Edited" },
    });
    fireEvent.change(screen.getByLabelText("Identity email"), {
      target: { value: "edited@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_identity", {
        name: "Edited",
        email: "edited@example.com",
        global: false,
      }),
    );
  });

  it("disables Save when name or email is empty", async () => {
    mockInvoke.mockResolvedValueOnce({
      effective: { name: "", email: "" },
      local: null,
      global: null,
    });
    render(<GitIdentitySettings />);
    await waitFor(() =>
      expect(screen.getByLabelText("Identity name")).toHaveValue(""),
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Identity name"), {
      target: { value: "Only Name" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // email still empty
  });
});

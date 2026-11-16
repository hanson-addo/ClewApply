import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "./AppHeader";

function renderHeader(email: string | null = "riley@example.com") {
  const onSignOut = vi.fn();
  render(
    <MemoryRouter>
      <AppHeader email={email} onSignOut={onSignOut} />
      <p>Outside</p>
    </MemoryRouter>,
  );
  return { onSignOut, account: screen.getByRole("button", { name: "Account" }) };
}

describe("account menu", () => {
  it("is closed until the avatar is pressed, then shows the email and sign out", async () => {
    const { account, onSignOut } = renderHeader();
    expect(account).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    await userEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("riley@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your profile" })).toHaveAttribute("href", "/profile");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("closes with Escape and gives focus back to the avatar", async () => {
    const { account } = renderHeader();
    await userEvent.click(account);
    await userEvent.keyboard("{Escape}");
    expect(account).toHaveAttribute("aria-expanded", "false");
    expect(account).toHaveFocus();
  });

  it("closes on a click outside", async () => {
    const { account } = renderHeader();
    await userEvent.click(account);
    await userEvent.click(screen.getByText("Outside"));
    expect(account).toHaveAttribute("aria-expanded", "false");
  });

  it("works without an email", async () => {
    const { account } = renderHeader(null);
    await userEvent.click(account);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});

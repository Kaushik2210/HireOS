import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPaletteTrigger } from "@/components/shell/command-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("CommandPaletteTrigger", () => {
  it("opens with Ctrl+K and lists actions", async () => {
    const user = userEvent.setup();
    render(<CommandPaletteTrigger />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Analyze resume")).toBeInTheDocument();
  });

  it("labels unbuilt actions as planned and does not navigate on select", async () => {
    const user = userEvent.setup();
    push.mockClear();
    render(<CommandPaletteTrigger />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));

    const planned = await screen.findByText("Optimize resume");
    expect(planned.closest("[cmdk-item]")).toHaveAttribute("aria-disabled", "true");
    await user.click(planned);
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates to live destinations", async () => {
    const user = userEvent.setup();
    push.mockClear();
    render(<CommandPaletteTrigger />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));
    await user.click(await screen.findByText("Dashboard"));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});

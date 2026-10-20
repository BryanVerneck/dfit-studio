import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

const options = [
  { value: "a", label: "Alfa" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gama" },
];

function Harness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("a");
  return (
    <>
      <Select label="Letra" value={value} options={options} onChange={(v) => { setValue(v); onChange(v); }} />
      <button type="button">outside</button>
    </>
  );
}

describe("Select", () => {
  it("shows the selected label and opens a list of options", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Letra" });
    expect(trigger).toHaveTextContent("Alfa");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Alfa" })).toHaveAttribute("aria-selected", "true");
  });

  it("picks an option with the mouse and closes", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Gama" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.getByRole("combobox")).toHaveTextContent("Gama");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("works with the keyboard", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    screen.getByRole("combobox").focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByRole("combobox")).toHaveTextContent("Beta");
    await user.keyboard("{Enter}{End}{Enter}");
    expect(screen.getByRole("combobox")).toHaveTextContent("Gama");
    await user.keyboard("{Enter}{Home}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Gama");
  });

  it("closes when clicking elsewhere", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("shows the studio name", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Dfit Studio" })).toBeInTheDocument();
  });
});

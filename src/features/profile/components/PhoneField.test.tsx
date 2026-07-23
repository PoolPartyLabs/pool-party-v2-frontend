/**
 * @covers PhoneField (PP-PROF-CMP-006) — POO-730 [R1..R4]
 *
 * The country dial code lives ONLY in the selector, never in the number input (R1); selecting a
 * country hands focus to the number input (R3); the invalid-phone error is blur-gated — hidden while
 * editing, shown on blur (R4); and the field still lifts canonical E.164 / "" (R2).
 */
import { fireEvent, render, screen, waitFor } from "../../../../tests/utils/renderWithProviders";
import { PhoneField } from "./PhoneField";

const LABEL = "Phone (optional)";
const COUNTRY_LABEL = "Phone country code";
const PHONE_ERROR = "Enter a valid phone number.";

function setup(props: { initialValue?: string; error?: string } = {}) {
  const onChange = vi.fn();
  render(
    <PhoneField
      label={LABEL}
      countryLabel={COUNTRY_LABEL}
      initialValue={props.initialValue ?? ""}
      error={props.error}
      onChange={onChange}
    />,
  );
  const input = screen.getByLabelText(LABEL) as HTMLInputElement;
  const country = screen.getByLabelText(COUNTRY_LABEL) as HTMLSelectElement;
  return { onChange, input, country };
}

describe("PhoneField", () => {
  // @rule R1: the dial code lives only in the selector; the input shows the national number only.
  it("never renders the dial code inside the number input (R1)", () => {
    const { input, country } = setup();
    expect(input.value).not.toContain("+");
    fireEvent.change(country, { target: { value: "br" } });
    fireEvent.change(input, { target: { value: "11987654321" } });
    expect(input.value).not.toContain("+");
    expect(input.value).not.toContain("+55");
  });

  // @rule R1: a stored E.164 seeds the national part only, and the selector reflects the country.
  it("seeds a stored E.164 as the national part with the matching country (R1)", () => {
    const { input, country } = setup({ initialValue: "+5511900000000" });
    expect(country.value).toBe("br");
    expect(input.value.startsWith("+")).toBe(false);
    expect(input.value).not.toContain("+55");
  });

  // @rule R3: selecting a country moves focus to the number input.
  it("moves focus to the number input when a country is selected (R3)", async () => {
    const { input, country } = setup();
    expect(input).not.toHaveFocus();
    fireEvent.change(country, { target: { value: "gb" } });
    await waitFor(() => expect(input).toHaveFocus());
  });

  // @rule R4: the error is suppressed while editing and shown on blur.
  it("suppresses the error while editing and shows it on blur (R4)", () => {
    const { input } = setup({ error: PHONE_ERROR });
    // Present on mount but not yet touched → hidden.
    expect(screen.queryByText(PHONE_ERROR)).toBeNull();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "555" } });
    expect(screen.queryByText(PHONE_ERROR)).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText(PHONE_ERROR)).toBeInTheDocument();
  });

  // @rule R4: the error re-hides as soon as the user edits the field again (they are fixing it).
  it("re-hides the error once the user edits the field again (R4)", () => {
    const { input } = setup({ error: PHONE_ERROR });
    fireEvent.blur(input);
    expect(screen.getByText(PHONE_ERROR)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "21" } });
    expect(screen.queryByText(PHONE_ERROR)).toBeNull();
  });

  // @rule R2: a valid number lifts canonical E.164; clearing the national part lifts "".
  it("lifts canonical E.164 for a valid number and '' when cleared (R2)", () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: "2133734253" } });
    const [value, valid] = onChange.mock.calls.at(-1) as [string, boolean];
    expect(valid).toBe(true);
    expect(value).toBe("+12133734253");

    fireEvent.change(input, { target: { value: "" } });
    const [cleared, clearedValid] = onChange.mock.calls.at(-1) as [string, boolean];
    expect(cleared).toBe("");
    expect(clearedValid).toBe(true);
  });
});

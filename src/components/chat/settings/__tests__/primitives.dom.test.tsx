// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  RangeControl,
  SegmentedField,
  SettingsCard,
  SettingsContext,
  SettingsRow,
  SettingsSelect,
  type SettingsContextValue,
} from "../primitives";
import { getSectionPosition } from "../schema";

const context = (
  overrides: Partial<SettingsContextValue> = {},
): SettingsContextValue => ({
  env: { desktop: false },
  query: "",
  target: null,
  registerEscape: () => () => {},
  openProfileEditor: () => {},
  openThemePreview: () => {},
  ...overrides,
});

function renderInSettings(
  ui: React.ReactElement,
  overrides?: Partial<SettingsContextValue>,
) {
  return render(
    <SettingsContext.Provider value={context(overrides)}>
      {ui}
    </SettingsContext.Provider>,
  );
}

describe("SettingsCard", () => {
  it("prints the section as a rule card: a heading legend and a 01 / 02 index", () => {
    renderInSettings(
      <SettingsCard id="profile">
        <SettingsRow id="display-name" layout="inline">
          {() => <span>Jon</span>}
        </SettingsRow>
      </SettingsCard>,
    );

    const card = screen.getByRole("region", { name: "Profile" });
    expect(card).toHaveAttribute("data-slot", "rule-card");
    expect(
      within(card).getByRole("heading", { level: 3, name: "Profile" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("01 / 02")).toBeInTheDocument();
  });

  it("titles a card outside the schema without an index", () => {
    renderInSettings(
      <SettingsCard title="Banned members">
        <SettingsRow id="x" label="Someone" layout="inline">
          {() => <span>Unban</span>}
        </SettingsRow>
      </SettingsCard>,
    );
    const card = screen.getByRole("region", { name: "Banned members" });
    expect(within(card).queryByText(/\d{2} \/ \d{2}/)).toBeNull();
  });

  it("counts sections a host leaves out of the index", () => {
    // Voice has five sections; rooms render it without the camera card.
    expect(getSectionPosition("screen-share", { desktop: false })).toEqual({
      index: 5,
      total: 5,
    });
    expect(
      getSectionPosition("screen-share", { desktop: false }, ["camera"]),
    ).toEqual({ index: 4, total: 4 });
  });

  it("hides a section none of whose rows match the search", () => {
    renderInSettings(
      <SettingsCard id="profile">
        <SettingsRow id="display-name" layout="inline">
          {() => <span>Jon</span>}
        </SettingsRow>
      </SettingsCard>,
      { query: "zzzz-nothing" },
    );
    expect(screen.queryByRole("region", { name: "Profile" })).toBeNull();
  });
});

describe("SettingsRow", () => {
  it("marks the row a search or link landed on", () => {
    const { container } = renderInSettings(
      <SettingsCard id="profile">
        <SettingsRow id="display-name" layout="inline">
          {() => <span>Jon</span>}
        </SettingsRow>
        <SettingsRow id="username" layout="inline">
          {() => <span>@jon</span>}
        </SettingsRow>
      </SettingsCard>,
      { target: "username" },
    );
    const landed = container.querySelector('[data-row="username"]');
    expect(landed).toHaveAttribute("data-target");
    expect(landed).toHaveClass("rm-settings-target");
    expect(
      container.querySelector('[data-row="display-name"]'),
    ).not.toHaveAttribute("data-target");
  });

  it("names a field row's select by its legend", () => {
    renderInSettings(
      <SettingsRow id="microphone" layout="field">
        {(ids) => (
          <SettingsSelect
            ids={ids}
            value="a"
            options={[
              { value: "a", label: "Shure MV7" },
              { value: "b", label: "Built-in" },
            ]}
            onValueChange={() => {}}
          />
        )}
      </SettingsRow>,
    );
    const trigger = screen.getByRole("combobox", { name: "Microphone" });
    expect(trigger).toHaveAttribute("data-size", "lg");
    // The legend is a label for the same control.
    expect(screen.getByText("Microphone").closest("label")).toHaveAttribute(
      "for",
      trigger.id,
    );
  });
});

describe("RangeControl", () => {
  function Harness({ onChange }: { onChange?: (v: number) => void }) {
    const [value, setValue] = useState(50);
    return (
      <SettingsRow id="input-volume" layout="block">
        {(ids) => (
          <RangeControl
            ids={ids}
            value={value}
            max={200}
            onChange={(next) => {
              setValue(next);
              onChange?.(next);
            }}
          />
        )}
      </SettingsRow>
    );
  }

  it("is a slider named by the row label with a spoken value", () => {
    renderInSettings(<Harness />);
    const slider = screen.getByRole("slider", { name: "Input volume" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuemax", "200");
    expect(slider).toHaveAttribute("aria-valuetext", "50%");
    expect(slider).toHaveAttribute("aria-labelledby");
  });

  it("moves by keyboard and reports the new value", () => {
    const onChange = vi.fn();
    renderInSettings(<Harness onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Input volume" });
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(51);
    expect(slider).toHaveAttribute("aria-valuenow", "51");
  });
});

describe("SegmentedField", () => {
  const options = [
    {
      value: "standard",
      label: "Voice isolation",
      desc: "Balanced processing.",
    },
    { value: "studio", label: "Studio", desc: "Pure stereo input." },
    { value: "custom", label: "Custom", desc: "Set each option below." },
  ] as const;

  function Harness({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] =
      useState<(typeof options)[number]["value"]>("standard");
    return (
      <SettingsRow id="input-profile" layout="block">
        {(ids) => (
          <SegmentedField
            ids={ids}
            value={value}
            options={options}
            onChange={(next) => {
              setValue(next);
              onChange?.(next);
            }}
          />
        )}
      </SettingsRow>
    );
  }

  it("is a radio group named by the row, with the chosen option described", () => {
    renderInSettings(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Input profile" });
    expect(
      within(group).getByRole("radio", { name: "Voice isolation" }),
    ).toBeChecked();
    expect(screen.getByText("Balanced processing.")).toBeInTheDocument();
    expect(screen.queryByText("Pure stereo input.")).toBeNull();
  });

  it("picks an option by click and by arrow key, and shows its description", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderInSettings(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Studio" }));
    expect(onChange).toHaveBeenLastCalledWith("studio");
    expect(screen.getByText("Pure stereo input.")).toBeInTheDocument();

    screen.getByRole("radio", { name: "Studio" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("custom");
    expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked();
    expect(screen.getByText("Set each option below.")).toBeInTheDocument();
  });
});

/**
 * @id PP-CORE-CMP-014
 * @name Tabs.stories
 * @implements-rules-version v1
 * Storybook coverage for the Tabs primitive: default, three tabs, and controlled usage.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const meta = {
  title: "UI/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two tabs, uncontrolled via defaultValue. */
export const TwoTabs: Story = {
  render: () => (
    <Tabs defaultValue="deposit" className="w-80">
      <TabsList aria-label="Account actions">
        <TabsTrigger value="deposit">Deposit</TabsTrigger>
        <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
      </TabsList>
      <TabsContent value="deposit" className="text-sm text-muted-foreground">
        Move funds in from your connected source.
      </TabsContent>
      <TabsContent value="withdraw" className="text-sm text-muted-foreground">
        Send funds out to an external destination.
      </TabsContent>
    </Tabs>
  ),
};

/** Three tabs, uncontrolled, showing the active vs inactive trigger styling. */
export const ThreeTabs: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-96">
      <TabsList aria-label="Pool sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="holdings">Holdings</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-sm">
        Strategy summary, risk band, and headline performance.
      </TabsContent>
      <TabsContent value="holdings" className="text-sm">
        Token allocations and their current USD value.
      </TabsContent>
      <TabsContent value="activity" className="text-sm">
        Recent deposits, withdrawals, and rebalances.
      </TabsContent>
    </Tabs>
  ),
};

/** Controlled mode: parent owns the active value via value + onValueChange. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState("monthly");
    return (
      <div className="flex w-96 flex-col gap-3">
        <Tabs value={value} onValueChange={setValue}>
          <TabsList aria-label="Reporting period">
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly">Yearly</TabsTrigger>
          </TabsList>
          <TabsContent value="daily" className="text-sm">
            Daily returns view.
          </TabsContent>
          <TabsContent value="monthly" className="text-sm">
            Monthly returns view.
          </TabsContent>
          <TabsContent value="yearly" className="text-sm">
            Yearly returns view.
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">Active value: {value}</p>
      </div>
    );
  },
};

/**
 * @id PP-MGR-CMP-073 (POO-2188)
 * @name ReviewIdentityCard.stories
 * @implements-rules-version v1
 * @analytics-events none: isolated props-only card states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ReviewIdentityCard } from "./ReviewIdentityCard";
import { reviewStoryKit } from "./reviewStoryKit";

const meta = {
  title: "Manager/Fund builder/Review/Identity",
  component: ReviewIdentityCard,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
  args: {
    name: reviewStoryKit.name,
    description: reviewStoryKit.description,
    imageUrl: reviewStoryKit.imageUrl,
    onNameChange: () => {},
    onDescriptionChange: () => {},
    onUploadLogo: async () => "https://example.com/logo.png",
  },
} satisfies Meta<typeof ReviewIdentityCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Saved: Story = {};
export const Empty: Story = { args: { name: "", description: "", imageUrl: "" } };
export const Uploading: Story = { args: { uploading: true } };
export const Failed: Story = {
  args: { uploadError: "Logo upload failed. Choose the logo again to retry." },
};
export const InvalidName: Story = {
  args: { name: "Short", nameError: "Use 10 to 50 characters for the strategy name." },
};
export const InvalidDescription: Story = {
  args: {
    description: "x".repeat(281),
    descriptionError: "Keep the description within 280 characters.",
  },
};
export const CropAndUpload: Story = {
  args: {
    imageUrl: "",
    onUploadLogo: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return "https://example.com/logo.png";
    },
  },
};
export const UploadFailure: Story = {
  args: {
    imageUrl: "",
    onUploadLogo: async () => {
      throw new Error("upload failed");
    },
  },
};

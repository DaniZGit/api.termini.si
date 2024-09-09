import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "slot-generation",
  name: "Slot Generation",
  icon: "box",
  description: "This flow generates slots on selected institution.",
  overview: ({ text }) => [
    {
      label: "Institution",
      text: text,
    },
  ],
  options: [
    {
      field: "institution",
      name: "institution",
      type: "json",
      meta: {
        width: "full",
        interface: "input",
      },
    },
  ],
});

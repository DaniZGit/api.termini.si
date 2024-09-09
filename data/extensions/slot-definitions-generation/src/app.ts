import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "slot-definitions-generation",
  name: "Generate Slot Definitions",
  icon: "box",
  description:
    "Operation to create slot definitions for selected court_schedule!",
  overview: ({ text }) => [
    {
      label: "Text",
      text: text,
    },
  ],
  options: [],
});

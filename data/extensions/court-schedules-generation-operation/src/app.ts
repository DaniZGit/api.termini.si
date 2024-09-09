import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "court-schedules-generation-operation",
  name: "Court schedule Generation",
  icon: "box",
  description: "This is my custom operation!",
  overview: ({ text }) => [
    {
      label: "Text",
      text: text,
    },
  ],
  options: [],
});

import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "operation-create-dates-and-slots",
  name: "Operation Dates/Slots Creation",
  icon: "box",
  description:
    "Operation for creating dates and slots from date/slot definitions",
  overview: () => [],
  options: [],
});

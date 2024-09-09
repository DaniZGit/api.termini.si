import { defineOperationApp } from "@directus/extensions-sdk";

export default defineOperationApp({
  id: "update-time-slots-weather",
  name: "Update weather data for time slots",
  icon: "box",
  description:
    "Gets weather from OpenWeatherMap and updates time_slots weather data!",
  overview: ({ text }) => [
    {
      label: "Text",
      text: text,
    },
  ],
  options: [],
});

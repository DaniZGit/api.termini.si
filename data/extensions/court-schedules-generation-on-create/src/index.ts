import { defineHook } from "@directus/extensions-sdk";

export default defineHook(({ filter, action }, { services }) => {
  const { ItemsService } = services;

  action("courts.items.create", (data, context) => {
    if (data.collection != "courts") return;

    console.log("Creating court_schedules for court with id", data.key);
    const day_of_weeks = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    const courtSchedulesService = new ItemsService("court_schedules", {
      schema: context.schema,
    });
    day_of_weeks.forEach(async (dow) => {
      courtSchedulesService.createOne({
        court: data.key,
        day_of_week: dow,
        open_time: "08:00",
        close_time: "20:00",
      });
    });
  });
});

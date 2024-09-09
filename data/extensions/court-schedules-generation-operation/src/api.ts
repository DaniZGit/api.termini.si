import { defineOperationApi } from "@directus/extensions-sdk";

type Options = {
  text: string;
};

export default defineOperationApi<Options>({
  id: "court-schedules-generation-operation",
  handler: async (options, context) => {
    const { ItemsService } = context.services;
    const trigger = context.data["$trigger"];
    const courtID = trigger.body.keys[0];
    const openTime = trigger.body.open_time;
    const closeTime = trigger.body.close_time;
    const days = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    const selectedDays: string[] = [];
    days.forEach((d) => {
      if (trigger.body[d]) selectedDays.push(d);
    });

    const courtScheduleService = new ItemsService("court_schedules", {
      schema: await context.getSchema(),
    });

    selectedDays.forEach(async (day) => {
      const data = await courtScheduleService.readByQuery({
        filter: {
          court: {
            _eq: courtID,
          },
          day_of_week: {
            _eq: day,
          },
        },
      });

      // if court_schedule for that day does not exist, add it
      if (!data.length) {
        console.log(
          "Adding new court_schedule for day",
          day,
          "at open time",
          openTime,
          "and close time",
          closeTime
        );
        courtScheduleService.createOne({
          court: courtID,
          day_of_week: day,
          open_time: openTime,
          close_time: closeTime,
        });
      }
    });
  },
});

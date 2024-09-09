import { defineOperationApi } from "@directus/extensions-sdk";
import { randomUUID } from "crypto";

type Options = {
  institution: {
    body: {
      date_start: string;
      date_end: string;
      keys: string[];
    };
  };
};

export default defineOperationApi<Options>({
  id: "slot-generation",
  handler: async (options, context) => {
    // some date functions
    const dayOfWeek = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];

    const dateFormatter = new Intl.DateTimeFormat("sl", {
      // we use 'sv' locale because it uses yyyy-mm-dd date format
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    function formatDate(date: Date) {
      const parts = dateFormatter.formatToParts(date) as {
        type: string;
        value: string;
      }[];
      return `${parts[4]?.value}-${parts[2]?.value.padStart(
        2,
        "0"
      )}-${parts[0]?.value.padStart(2, "0")}`;
    }

    function getDateDayOfWeek(date: Date) {
      return dayOfWeek[date.getDay()];
    }

    function getDaysBetweenDates(date1: Date, date2: Date) {
      let Difference_In_Time = date2.getTime() - date1.getTime();

      // Calculating the no. of days between
      // two dates
      let differenceInDays = Math.round(
        Difference_In_Time / (1000 * 3600 * 24)
      );

      return differenceInDays;
    }

    if (
      !context.data["$trigger"] ||
      !context.data["$trigger"].body ||
      !context.data["$trigger"].body.date_start ||
      !context.data["$trigger"].body.date_end
    )
      return;

    console.log(
      "Generating slots for institution with id",
      options.institution.body.keys[0]
    );
    fetchCourts();

    async function fetchCourts() {
      // get courts with schedule definitions
      const courts = await context
        .database("courts")
        .select([
          "courts.*",
          context.database.raw(
            "CASE WHEN COUNT(court_schedules) = 0 THEN '[]' ELSE json_agg(court_schedules.*) END as court_schedules"
          ),
        ])
        .join("court_schedules", "courts.id", "=", "court_schedules.court")
        .join(
          "slot_definitions",
          "court_schedules.id",
          "=",
          "slot_definitions.court_schedule"
        )
        .where("institution", options.institution.body.keys[0])
        .groupBy(["courts.id"]);

      // loop courts
      courts.forEach((court) => {
        generateSlots(court);
      });
    }

    async function generateSlots(court) {
      let date_start = new Date(
        context.data["$trigger"].body.date_start as string
      );
      let date_end = new Date(context.data["$trigger"].body.date_end as string);

      // make sure date_start is not less than today
      if (new Date().getTime() > date_start.getTime()) date_start = new Date();

      // check if date_start is less than date_end
      if (date_start.getTime() > date_end.getTime()) date_end = date_start;

      // get days between date_start and date_end
      const days = getDaysBetweenDates(date_start, date_end) + 1; // +1 for today

      for (let i = 0; i < days; i++) {
        const tmpDate = new Date(date_start);
        tmpDate.setDate(date_start.getDate() + i);

        // find court schedule for this date - filter by day_of_week
        const dayOfWeek = getDateDayOfWeek(tmpDate);
        const courtSchedule = court.court_schedules.find(
          (cs) => cs.day_of_week == dayOfWeek
        );
        // if no court schedule is configured for this day of the week, skip
        if (!courtSchedule) continue;

        // check if ScheduleDay with this date already exists on the court - skip if it does
        const existingScheduleDays = await context
          .database("schedule_days")
          .where({
            court: court.id,
            date: formatDate(tmpDate),
          });
        // if (existingScheduleDays.length) continue;

        // create a new ScheduleDay for court
        const scheduleDayId = await context.database("schedule_days").insert(
          {
            id: randomUUID(),
            court: court.id,
            date: formatDate(tmpDate),
          },
          ["id"]
        );

        // get slot definitions for this court schedule
        const slotDefinitions = await context
          .database("slot_definitions")
          .where("court_schedule", courtSchedule.id);

        // add time slots based on the definitions
        slotDefinitions.forEach(async (sd) => {
          const timeSlot = await context.database("time_slots").insert(
            {
              id: randomUUID(),
              schedule_day: scheduleDayId[0].id,
              start_time: sd.start_time,
              end_time: sd.end_time,
              price: 8.0,
              status: "available",
            },
            "*"
          );
        });
      }
      return;
    }
  },
});

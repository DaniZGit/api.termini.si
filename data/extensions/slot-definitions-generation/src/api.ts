import { defineOperationApi } from "@directus/extensions-sdk";
import { randomUUID } from "crypto";
import { start } from "repl";

type Options = {
  text: string;
};

export default defineOperationApi<Options>({
  id: "slot-definitions-generation",
  handler: async (options, context) => {
    if (
      !context.data["$trigger"] ||
      !context.data["$trigger"].body ||
      context.data["$trigger"].body.collection != "court_schedules" ||
      !context.data["$trigger"].body.start_time ||
      !context.data["$trigger"].body.end_time ||
      !context.data["$trigger"].body.slot_duration
    )
      return;

    console.log(
      "Generating slot_definitions for court_schedule with id",
      context.data["$trigger"].body.keys[0]
    );
    let start_time_date = new Date(
      `1970-01-01 ${context.data["$trigger"].body.start_time}`
    );
    let end_time_date = new Date(
      `1970-01-01 ${context.data["$trigger"].body.end_time}`
    );
    const slot_duration = context.data["$trigger"].body.slot_duration;

    // check if start_time_date is more than end_time_date
    if (start_time_date.getTime() > end_time_date.getTime())
      end_time_date = start_time_date;

    const start_time_obj = {
      hours: start_time_date.getHours(),
      minutes: start_time_date.getMinutes(),
    };
    const end_time_obj = {
      hours: end_time_date.getHours(),
      minutes: end_time_date.getMinutes(),
    };

    const diff_in_minutes =
      end_time_obj.hours * 60 +
      end_time_obj.minutes -
      (start_time_obj.hours * 60 + start_time_obj.minutes);

    const slotsAmount = Math.floor(diff_in_minutes / slot_duration);

    for (let i = 0; i < slotsAmount; i++) {
      const tmp_start_time_date = new Date(start_time_date);
      start_time_date.setTime(
        start_time_date.getTime() + slot_duration * 60 * 1000
      );

      const start_time = convertDateToTime(tmp_start_time_date);
      const end_time = convertDateToTime(start_time_date);

      // check if slots already exist in between the times
      const courtScheduleID = context.data["$trigger"].body.keys[0];
      const timeSlots = await context // generated query: select * from "slot_definitions" where ("court_schedule" = '0d59acb3-8172-41c7-83e4-092732a0b2e6' and (("start_time" >= '20:30' and "start_time" <= '21:00') or ("end_time" >= '20:30' and "end_time" <= '21:00') or ("start_time" <= '20:30' and "start_time" <= '21:00' and "end_time" >= '20:30' and "end_time" >= '21:00')))
        .database("slot_definitions")
        .where(function () {
          this.where("court_schedule", courtScheduleID).andWhere(function () {
            this.where(function () {
              this.where("start_time", ">=", start_time).andWhere(
                "start_time",
                "<",
                end_time
              );
            })
              .orWhere(function () {
                this.where("end_time", ">", start_time).andWhere(
                  "end_time",
                  "<=",
                  end_time
                );
              })
              .orWhere(function () {
                this.where("start_time", "<=", start_time)
                  .andWhere("start_time", "<=", end_time)
                  .andWhere("end_time", ">=", start_time)
                  .andWhere("end_time", ">=", end_time);
              });
          });
        });
      // skip if this time slot is already filled
      if (timeSlots.length) continue;

      await context.database("slot_definitions").insert({
        id: randomUUID(),
        court_schedule: courtScheduleID,
        start_time: start_time,
        end_time: end_time,
        status: "available",
      });
    }

    function convertDateToTime(date: Date) {
      return (
        `${date.getHours()}`.padStart(2, "0") +
        ":" +
        `${date.getMinutes()}`.padStart(2, "0")
      );
    }
  },
});

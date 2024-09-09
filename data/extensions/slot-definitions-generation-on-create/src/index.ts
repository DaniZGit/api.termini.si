import { defineHook } from "@directus/extensions-sdk";
import { randomUUID } from "crypto";

export default defineHook(({ action }, { services }) => {
  const { ItemsService } = services;

  action("court_schedules.items.create", async (data, context) => {
    const courtSchedulesService = new ItemsService("court_schedules", {
      schema: context.schema,
    });
    const courtSchedule = await courtSchedulesService.readOne(data.key);
    if (!courtSchedule) return;

    let start_time_date = new Date(`1970-01-01 ${courtSchedule.open_time}`);
    let end_time_date = new Date(`1970-01-01 ${courtSchedule.close_time}`);
    const slot_duration = 60;

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
      const timeSlots = await context
        .database("slot_definitions")
        .where("court_schedule", courtSchedule.id)
        .andWhere(function () {
          this.where(function () {
            this.where("start_time", ">", start_time).andWhere(
              "start_time",
              "<",
              end_time
            );
          })
            .orWhere(function () {
              this.where("end_time", ">", start_time).andWhere(
                "end_time",
                "<",
                end_time
              );
            })
            .orWhere(function () {
              this.where("start_time", "<", start_time)
                .andWhere("start_time", "<", end_time)
                .andWhere("end_time", ">", start_time)
                .andWhere("end_time", ">", end_time);
            });
        });
      // skip if this time slot is already filled
      if (timeSlots.length) continue;

      console.log(
        "Creating slot_definitions for court_schedule with id",
        data.key
      );

      const slotDefinitionsService = new ItemsService("slot_definitions", {
        schema: context.schema,
      });
      slotDefinitionsService.createOne({
        court_schedule: courtSchedule.id,
        start_time: start_time,
        end_time: end_time,
        price: 8.0,
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
  });
});

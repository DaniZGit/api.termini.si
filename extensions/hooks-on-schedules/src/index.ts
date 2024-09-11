import { defineHook } from "@directus/extensions-sdk";
import {} from "./";

export default defineHook(({ filter, action }, { services, logger }) => {
  const { ItemsService } = services;

  action("schedules.items.create", async (meta, context) => {
    await createScheduleDateDefinitions(context, meta.key);
  });

  const createScheduleDateDefinitions = async (context, scheduleID) => {
    const dateDefinitionsService = new ItemsService("date_definitions", {
      schema: context.schema,
      accountability: context.accountability,
    });

    const daysOfTheWeek = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    const dateDefinitions = daysOfTheWeek.map((dayOfWeek) => ({
      day_of_week: dayOfWeek,
      schedule: scheduleID,
    }));

    const [data, error] = await tryCatcher(
      dateDefinitionsService.createMany(dateDefinitions)
    );
    if (error) {
      logger.error(
        `Something went wrong while creating schedule's date definitions: ${error.message}`
      );
    }
  };
});

async function tryCatcher<T, E = Error>(
  promise: Promise<T>
): Promise<[T, null] | [null, E]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}

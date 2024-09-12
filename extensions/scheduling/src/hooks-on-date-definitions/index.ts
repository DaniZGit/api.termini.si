import { defineHook } from "@directus/extensions-sdk";
import { createError } from "@directus/errors";

const EXISTING_DATE_DEFINITION_ERROR = createError(
  "EXISTING_DATE_DEFINITION_ERROR",
  "Date definition with this day_of_week already exists",
  400
);

export default defineHook(
  ({ filter, action }, { services, logger, getSchema }) => {
    const { ItemsService } = services;

    filter("date_definitions.items.create", async (meta, context) => {
      const schema = await getSchema();

      const valid = await validateDateDefinition(schema, meta);
      if (!valid) throw new EXISTING_DATE_DEFINITION_ERROR();

      return meta;
    });

    const validateDateDefinition = async (schema, dateDefinitionData) => {
      const schedulesService = new ItemsService("schedules", {
        schema: schema,
      });

      const [schedule, error] = await tryCatcher(
        schedulesService.readOne(dateDefinitionData.schedule, {
          fields: ["id", "date_definitions.id", "date_definitions.day_of_week"],
        })
      );
      if (error) {
        logger.error(
          `Something went wrong while reading date definition's schedule: ${error.message}`
        );
        return false;
      }

      const existingDateDefinition = schedule.date_definitions.find(
        (dateDefinition) =>
          dateDefinitionData.day_of_week == dateDefinition.day_of_week
      );
      return existingDateDefinition ? false : true;
    };
  }
);

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

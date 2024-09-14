import { defineHook } from "@directus/extensions-sdk";
import { createError } from "@directus/errors";

const EXISTING_DATE_DEFINITION_ERROR = createError(
  "EXISTING_SERVICE_TYPE_ERROR",
  "Service with this type already exists",
  400
);

export default defineHook(
  ({ filter, action }, { services, logger, getSchema }) => {
    const { ItemsService } = services;

    filter("services.items.create", async (meta, context) => {
      const schema = await getSchema();

      const valid = await validateService(schema, meta);
      if (!valid) throw new EXISTING_DATE_DEFINITION_ERROR();

      return meta;
    });

    const validateService = async (schema, serviceData) => {
      const servicesService = new ItemsService("services", {
        schema: schema,
      });

      const [services, error] = await tryCatcher<any[]>(
        servicesService.readByQuery({
          fields: ["id", "type"],
          filter: {
            institution: {
              id: {
                _eq: serviceData.institution,
              },
            },
            type: {
              _eq: serviceData.type,
            },
          },
        })
      );
      if (error) {
        logger.error(
          `Something went wrong while reading date definition's schedule: ${error.message}`
        );
        return false;
      }

      return services.length ? false : true;
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

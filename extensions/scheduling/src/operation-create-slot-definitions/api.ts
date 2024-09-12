import { defineOperationApi } from "@directus/extensions-sdk";
import { createError } from "@directus/errors";

const VALID_TIME_ERROR = createError(
  "VALID_TIME_ERROR",
  "Time must not be empty or 00:00:00",
  400
);

type TriggerData = {
  start_time: string;
  end_time: string;
  duration: string;
  price: string;
  collection: string;
  keys: Array<string>;
};

export default defineOperationApi({
  id: "operation-create-slot-definitions",
  handler: async (options, context) => {
    if (!context.data["$trigger"] || !context.data["$trigger"].body) return;

    const schema = await context.getSchema();
    const triggerData = context.data["$trigger"].body as TriggerData;

    if (
      !triggerData.start_time ||
      !triggerData.end_time ||
      !triggerData.duration ||
      triggerData.start_time == "00:00:00" ||
      triggerData.end_time == "00:00:00" ||
      triggerData.duration == "00:00:00"
    ) {
      console.log("throwing valid time error");
      throw new VALID_TIME_ERROR();
    }

    await generateSlotDefinitions(schema, context, triggerData);
  },
});

const generateSlotDefinitions = async (
  schema: any,
  context: any,
  triggerData: any
) => {
  const logger = context.logger;
  const { ItemsService } = context.services;
  const slotDefinitionsService = new ItemsService("slot_definitions", {
    schema: schema,
    accountability: context.accountability,
  });

  let start_time_date = new Date(`1970-01-01 ${triggerData.start_time}`);
  let end_time_date = new Date(`1970-01-01 ${triggerData.end_time}`);
  const slot_duration_date = new Date(`1970-01-01 ${triggerData.duration}`);
  const slot_duration =
    slot_duration_date.getHours() * 60 + slot_duration_date.getMinutes();
  const slot_price = parseFloat(triggerData.price) || 0;

  // check if start_time_date is more than end_time_date
  if (start_time_date.getTime() > end_time_date.getTime())
    end_time_date = start_time_date;

  // store hours/minutes
  const start_time_obj = {
    hours: start_time_date.getHours(),
    minutes: start_time_date.getMinutes(),
  };
  const end_time_obj = {
    hours: end_time_date.getHours(),
    minutes: end_time_date.getMinutes(),
  };

  // get difference between the times (in minutes)
  const diff_in_minutes =
    end_time_obj.hours * 60 +
    end_time_obj.minutes -
    (start_time_obj.hours * 60 + start_time_obj.minutes);

  // calculate the amount of slots that need to be created in between the set times (based on duration)
  const slotsAmount = Math.floor(diff_in_minutes / slot_duration);

  // loop through all selected date_definitions
  for (let k = 0; k < context.data["$trigger"].body.keys.length; k++) {
    const dateDefinitionID = context.data["$trigger"].body.keys[k];

    // create slot definitions
    for (let i = 0; i < slotsAmount; i++) {
      const tmp_start_time_date = new Date(start_time_date);
      start_time_date.setTime(
        start_time_date.getTime() + slot_duration * 60 * 1000
      );

      const start_time = convertDateToTime(tmp_start_time_date);
      const end_time = convertDateToTime(start_time_date);

      // check if there is already an existing slot defintion at this time span
      const [slotDefinitions, readError] = await tryCatcher<any[]>(
        slotDefinitionsService.readByQuery({
          filter: {
            _and: [
              {
                date_definition: {
                  _eq: dateDefinitionID,
                },
              },
              {
                _or: [
                  {
                    _and: [
                      {
                        start_time: {
                          _gt: start_time,
                        },
                      },
                      {
                        start_time: {
                          _lt: end_time,
                        },
                      },
                    ],
                  },
                  {
                    _and: [
                      {
                        end_time: {
                          _gt: start_time,
                        },
                      },
                      {
                        end_time: {
                          _lt: end_time,
                        },
                      },
                    ],
                  },
                  {
                    _and: [
                      {
                        start_time: {
                          _lte: start_time,
                        },
                      },
                      {
                        start_time: {
                          _lte: end_time,
                        },
                      },
                      {
                        end_time: {
                          _gte: start_time,
                        },
                      },
                      {
                        end_time: {
                          _gte: end_time,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        })
      );
      if (readError) {
        logger.error(
          `Error while reading slot definitions: ${readError?.message}`
        );
        continue;
      } else if (slotDefinitions.length) {
        // slot definition within the time span already exists
        continue;
      }

      // create slot definition
      const [slotDefinition, createError] = await tryCatcher<any>(
        slotDefinitionsService.createOne({
          date_definition: dateDefinitionID,
          start_time: start_time,
          end_time: end_time,
          price: slot_price,
          available: true,
        })
      );
      if (createError) {
        logger.error(
          `Something went wrong while creating slot definition: ${createError.message}`
        );
      }
    }
  }
};

const convertDateToTime = (date: Date) => {
  return (
    `${date.getHours()}`.padStart(2, "0") +
    ":" +
    `${date.getMinutes()}`.padStart(2, "0")
  );
};

export async function tryCatcher<T, E = Error>(
  promise: Promise<T>
): Promise<[T, null] | [null, E]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}
